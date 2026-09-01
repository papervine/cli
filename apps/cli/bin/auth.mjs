// The pure decision core for `papervine signup` / `login` / `logout` / `whoami`, split out of
// `papervine.mjs` for the same reason `args.mjs` is (unit-tested in
// `tests/unit/cli-auth.test.ts`): everything here is a pure function over its inputs — no
// network, no filesystem, no `process`. The bin script does the I/O.
//
// **The CLI never handles a password.** It runs the OAuth 2.0 Device Authorization Grant
// (RFC 8628) against the hosted control plane: ask for a code, show the user a URL, poll until
// they approve in a browser. That is what makes `signup` and `login` the *same* flow differing
// only in which page the browser lands on — and it is why social sign-in (Google, GitHub) works
// from a terminal at all, which a `--email/--password` prompt could never do.
//
// The flow is also deliberately not CLI-shaped underneath: the endpoints are advertised at
// `/.well-known/oauth-authorization-server` (RFC 8414), so an agent that speaks the device
// grant can authorize itself without this package. These commands are a convenience over a
// public door, not the door.

import { parseArgs } from "node:util";
import path from "node:path";

/** The public client identifier this CLI presents. Public client, no secret (RFC 8628 §3.1). */
export const CLIENT_ID = "papervine-cli";

/** The hosted control plane, when `--url` / `PAPERVINE_API_URL` say nothing. */
export const DEFAULT_API_URL = "https://papervine.io";

/** How long to keep polling before giving up, regardless of what the server said. */
export const MAX_POLL_SECONDS = 15 * 60;

/**
 * Parse the arguments shared by `signup`, `login`, `logout` and `whoami`.
 *
 * One parser for all four because they address the same thing — a control plane and the
 * credential stored for it — and a flag surface that differs per verb would be noise.
 *
 * @param {string[]} argv - args after the subcommand
 * @returns {{help: boolean, url: string|undefined, browser: boolean}}
 * @throws {Error} on an unknown flag, a positional, or an empty --url
 */
export function parseAuthArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      // Point the flow at a self-hosted control plane. The credential store is keyed by
      // origin, so signing in to two of them is not a conflict.
      url: { type: "string" },
      // Print the URL and stop there. The default opens a browser, which is wrong in a
      // container, over SSH, or when an agent is driving and a human will follow the link.
      "no-browser": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) return { help: true, url: undefined, browser: true };

  if (positionals.length) {
    throw new Error(`unexpected argument "${positionals[0]}" — this command takes no directory`);
  }
  if (values.url !== undefined && values.url.trim() === "") {
    throw new Error("--url needs a value, e.g. --url https://papervine.io");
  }

  return {
    help: false,
    url: values.url?.trim(),
    browser: !values["no-browser"],
  };
}

/**
 * Normalize a control-plane URL to a bare origin: `papervine.io` → `https://papervine.io`,
 * `http://app.localhost:3000/device` → `http://app.localhost:3000`.
 *
 * A scheme-less host is the thing people actually type, and rejecting it would be pedantic —
 * but the assumed scheme is **https**, never http: a token is about to travel over this.
 * `localhost` and `127.0.0.1` are the exception, because a self-hoster testing locally has no
 * certificate and refusing them would make the flow untestable.
 *
 * @param {string} input
 * @returns {string} an origin, no trailing slash
 * @throws {Error} when it isn't a URL at all, or isn't http(s)
 */
export function normalizeApiOrigin(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("no control-plane URL given");

  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)|\.localhost(:|$)/i.test(
    raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""),
  );
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `${local ? "http" : "https"}://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`unsupported scheme "${url.protocol}" — use https://`);
  }
  return url.origin;
}

/**
 * Resolve which control plane a command is talking to: `--url`, then `PAPERVINE_API_URL`, then
 * the hosted default.
 *
 * @param {{url?: string}} plan
 * @param {Record<string, string|undefined>} env
 */
export function resolveApiOrigin(plan, env = {}) {
  return normalizeApiOrigin(plan?.url || env.PAPERVINE_API_URL || DEFAULT_API_URL);
}

/** A Better Auth endpoint on a given control plane. */
export function authEndpoint(origin, endpointPath) {
  return `${origin}/api/auth${endpointPath}`;
}

/**
 * Where the credential file lives.
 *
 * XDG on Linux/macOS (`$XDG_CONFIG_HOME`, else `~/.config`), `%APPDATA%` on Windows. Not
 * `~/.papervine`: a tool that writes a dotfile per concern into someone's home directory is a
 * tool that will be asked to stop.
 *
 * @param {{env?: Record<string, string|undefined>, home?: string, platform?: string}} [ctx]
 */
export function credentialsPath({ env = {}, home = "", platform = "linux" } = {}) {
  if (platform === "win32" && env.APPDATA) {
    return path.win32.join(env.APPDATA, "papervine", "credentials.json");
  }
  const base = env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
  return path.join(base, "papervine", "credentials.json");
}

/** An empty store, and the shape every transform below preserves. */
export function emptyStore() {
  return { version: 1, credentials: {} };
}

/**
 * Coerce whatever was on disk into a usable store.
 *
 * A hand-edited or truncated file must never be a hard failure: the worst case is being asked
 * to sign in again, and that is a much better outcome than a CLI that refuses to run because
 * its cache is malformed.
 */
export function parseStore(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch {
    return emptyStore();
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return emptyStore();
  const credentials =
    data.credentials && typeof data.credentials === "object" && !Array.isArray(data.credentials)
      ? data.credentials
      : {};
  return { version: 1, credentials };
}

/**
 * The credential for an origin, or null — expired ones read as absent.
 *
 * Checking expiry here rather than at the call site is deliberate: an expired session token
 * would otherwise reach the server and come back as a bare 401, which reads as "something is
 * broken" instead of "sign in again".
 *
 * @param {ReturnType<typeof parseStore>} store
 * @param {string} origin
 * @param {number} now - epoch ms
 */
export function readCredential(store, origin, now = Date.now()) {
  const cred = store?.credentials?.[origin];
  if (!cred || typeof cred.accessToken !== "string" || !cred.accessToken) return null;
  if (cred.expiresAt && Date.parse(cred.expiresAt) <= now) return null;
  return cred;
}

/**
 * Store a credential for an origin. Returns a NEW store — the caller writes it.
 *
 * @param {ReturnType<typeof parseStore>} store
 * @param {string} origin
 * @param {{accessToken: string, expiresIn?: number, email?: string, name?: string}} token
 * @param {number} now - epoch ms
 */
export function upsertCredential(store, origin, token, now = Date.now()) {
  const expiresAt =
    typeof token.expiresIn === "number" && token.expiresIn > 0
      ? new Date(now + token.expiresIn * 1000).toISOString()
      : undefined;
  return {
    version: 1,
    credentials: {
      ...(store?.credentials ?? {}),
      [origin]: {
        accessToken: token.accessToken,
        ...(expiresAt ? { expiresAt } : {}),
        ...(token.email ? { email: token.email } : {}),
        ...(token.name ? { name: token.name } : {}),
        savedAt: new Date(now).toISOString(),
      },
    },
  };
}

/**
 * Drop the credential for an origin. Returns `{store, removed}` so `logout` can say whether
 * there was anything to sign out of — "signed out" when nothing happened is a small lie that
 * hides a mistyped `--url`.
 */
export function removeCredential(store, origin) {
  const credentials = { ...(store?.credentials ?? {}) };
  const removed = Object.prototype.hasOwnProperty.call(credentials, origin);
  delete credentials[origin];
  return { store: { version: 1, credentials }, removed };
}

/**
 * The URL to send the human to.
 *
 * `login` uses the server's own `verification_uri_complete` (RFC 8628 §3.3.1) — the code is
 * already in it, so there is nothing to type. `signup` can't: the browser has to reach the
 * sign-up form *first* and the device page *after*, so the code rides along in `?redirect=`
 * and the control plane resumes it once an account exists. Same grant, same code, one extra
 * hop.
 *
 * @param {{verificationUri: string, verificationUriComplete?: string, userCode: string,
 *          create?: boolean}} params
 */
export function verificationTarget({
  verificationUri,
  verificationUriComplete,
  userCode,
  create = false,
}) {
  const base = new URL(verificationUri);
  if (!create) {
    return verificationUriComplete || `${base.origin}${base.pathname}?user_code=${encodeURIComponent(userCode)}`;
  }
  const resume = `${base.pathname}?user_code=${encodeURIComponent(userCode)}`;
  return `${base.origin}/signup?redirect=${encodeURIComponent(resume)}`;
}

/**
 * `ABCD1234` → `ABCD-1234`: a code that is read aloud and typed by hand gets a separator.
 *
 * A near-twin of `src/lib/device-code.ts` in the web app, and deliberately not shared: the
 * packaging boundary (SPEC §10.6) means this package cannot import from the control plane, and
 * pulling `@papervine/renderer` into a display concern would be worse than eight lines. The
 * separator is cosmetic on both ends — the server strips it before every lookup — so the two
 * can drift without breaking anything.
 */
export function formatUserCode(code) {
  const clean = String(code ?? "").trim();
  if (clean.includes("-") || clean.length < 6 || clean.length > 12) return clean;
  const mid = Math.ceil(clean.length / 2);
  return `${clean.slice(0, mid)}-${clean.slice(mid)}`;
}

/**
 * The RFC 8628 §3.5 polling state machine, as a pure decision.
 *
 * Written as a function of (server response, current interval) rather than inlined into the
 * poll loop so the awkward cases are testable without a server: `slow_down` must *widen* the
 * interval permanently (a client that ignores it gets throttled or blocked), and an
 * unrecognized error must stop rather than spin — polling forever against a server that is
 * telling us something we don't understand is how a "hung" CLI happens.
 *
 * @param {{ok?: boolean, error?: string, errorDescription?: string}} res
 * @param {number} intervalSeconds - the interval currently in force
 * @returns {{action: "done"|"wait"|"stop", intervalSeconds: number, message?: string}}
 */
export function pollDecision(res, intervalSeconds) {
  const interval = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 5;
  if (res?.ok) return { action: "done", intervalSeconds: interval };

  switch (res?.error) {
    case "authorization_pending":
      return { action: "wait", intervalSeconds: interval };
    // "You are polling too frequently" — RFC 8628 requires the interval to grow by 5s and
    // stay grown. Not a retry-once concession.
    case "slow_down":
      return { action: "wait", intervalSeconds: interval + 5 };
    case "access_denied":
      return {
        action: "stop",
        intervalSeconds: interval,
        message: "request denied in the browser.",
      };
    case "expired_token":
      return {
        action: "stop",
        intervalSeconds: interval,
        message: "the code expired before it was approved — run the command again.",
      };
    default:
      return {
        action: "stop",
        intervalSeconds: interval,
        message: res?.errorDescription || res?.error || "the control plane rejected the request.",
      };
  }
}
