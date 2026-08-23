"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import clsx from "clsx";
import { Play, Loader2, X, ChevronDown, ChevronRight, Copy, Check, Eye, EyeOff } from "lucide-react";
import { methodColor } from "../../lib/method-colors";
import { playgroundHref, playgroundRequested, playgroundUrl } from "../../lib/playground-url";
import { shellQuote } from "../../lib/shell-quote";
import { withBase } from "../../lib/url-base";
import {
  authFieldKeys,
  authOptionLabel,
  authorizationConflicts,
  clearCredentials,
  credentialScope,
  defaultAuthChoice,
  hasStoredCredentials,
  readAuthChoice,
  readCredentials,
  sessionCredentialStore,
  writeAuthChoice,
  writeCredentials,
  type TryItAuth,
} from "../../lib/try-it-credentials";

/**
 * The interactive API "Try it" playground (hosted docs platforms model): the trigger lives on the endpoint
 * bar in the center column, and clicking it opens a full modal that encompasses every OpenAPI
 * input class — security schemes (basic / bearer / apiKey / oauth2), headers, path, query, and
 * request body — each as an editable field. A live request sample (cURL / JavaScript / Python)
 * and the response render on the right. "Send" fires a real browser `fetch`; CORS is the live
 * constraint (a server-side proxy is the eventual fix), and a cross-origin failure degrades to
 * an inline message rather than throwing.
 *
 * Code is generated and lightly colorized on the client (the modal is opt-in, so we avoid
 * shipping Shiki) — the page's read-only right rail keeps the server-highlighted samples.
 */

export type TryItParam = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  example?: string;
  type?: string;
  description?: string;
};
export type { TryItAuth };
export type TryItSibling = { slug: string; method: string; summary: string };
export type TryItProps = {
  method: string;
  baseUrl: string;
  path: string;
  summary: string;
  params: TryItParam[];
  // The operation's security alternatives: outer = OR (the reader picks one), inner = AND (all of
  // those schemes are sent together). Mirrors `AuthOptions` in `lib/openapi.ts`.
  auth: TryItAuth[][];
  bodySample?: string;
  siblings: TryItSibling[];
  // Which spec these credentials belong to — scopes the remembered credentials so two specs
  // (or two tenants sharing an origin in apex path mode) never prefill each other's.
  specPath: string;
  // The tenant's URL base (`/sites/{slug}` in apex path mode, empty on the tenant's own host).
  // The operation switcher's links are internal, so they need it like every other internal link.
  siteBase?: string;
};

type LiveResponse = { status: number; statusText: string; body: string; ok: boolean };

// ---- tiny client colorizers (avoid bundling Shiki for the opt-in modal) ----
const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

function colorizeJson(src: string): string {
  return escapeHtml(src).replace(
    /("(?:\\.|[^"\\])*"(\s*:)?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, isKey, lit, num) => {
      if (str) return `<span class="${isKey ? "text-sky-300" : "text-amber-300"}">${str}</span>`;
      if (lit) return `<span class="text-violet-300">${lit}</span>`;
      if (num) return `<span class="text-emerald-300">${num}</span>`;
      return m;
    },
  );
}

function colorizeShell(src: string): string {
  // Strings amber, long/short flags muted blue — enough to read like the page's cURL panel.
  return escapeHtml(src)
    .replace(/('(?:\\.|[^'\\])*')/g, '<span class="text-amber-300">$1</span>')
    .replace(/(\s)(--?[a-zA-Z][\w-]*)/g, '$1<span class="text-sky-300">$2</span>');
}

function fieldKey(p: TryItParam): string {
  return `${p.in}:${p.name}`;
}

/** Keep the URL honest about what's on screen. `replaceState`, not a router navigation: the route
 *  isn't changing — only this flag is — so nothing remounts underneath the open modal. */
function syncPlaygroundUrl(open: boolean): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(
    window.history.state,
    "",
    playgroundUrl(window.location.href, open),
  );
}

// Persistent, theme-matched scrollbar for the modal's scroll panes (the results window
// especially). Defining ::-webkit-scrollbar disables macOS's fade-out overlay scrollbar, so it
// stays visible; `overflow-y-scroll` on the pane keeps the track reserved even for short bodies.
const TRY_IT_SCROLL_CSS = `
.try-it-scroll{scrollbar-width:thin;scrollbar-color:#52525b transparent}
.try-it-scroll::-webkit-scrollbar{width:12px;height:12px}
.try-it-scroll::-webkit-scrollbar-track{background:transparent}
.try-it-scroll::-webkit-scrollbar-thumb{background-color:#3f3f46;border-radius:9999px;border:3px solid transparent;background-clip:content-box}
.try-it-scroll::-webkit-scrollbar-thumb:hover{background-color:#52525b}
`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded p-1 text-zinc-400 hover:text-zinc-100"
      aria-label="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Section({
  title,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  // Optional control in the header row. Kept a sibling of the toggle, not a child — a button
  // nested inside a button is invalid HTML and swallows its own clicks.
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-2 pr-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-sm font-semibold text-zinc-200"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="space-y-4 px-4 pb-4">{children}</div>}
    </div>
  );
}

function Field({
  label,
  type,
  required,
  description,
  value,
  onChange,
  placeholder,
  mono,
  secret,
}: {
  label: string;
  type?: string;
  required?: boolean;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  // Credential field (password / token / api key): mask the value as dots with an eye toggle.
  secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium text-zinc-200">{label}</span>
        {type && <span className="text-xs text-zinc-500">{type}</span>}
        {required && (
          <span className="rounded bg-red-950 px-1.5 py-0.5 text-[0.6rem] font-medium text-red-300">
            required
          </span>
        )}
      </div>
      {description && <p className="mb-1.5 text-xs text-zinc-400">{description}</p>}
      <div className="relative">
        <input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={clsx(
            "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-primary focus:outline-none",
            secret && "pr-10",
            mono && "font-mono",
          )}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-200"
            aria-label={show ? "Hide value" : "Show value"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Trigger + playground. State is per-operation, which the App Router gives us for free: navigating
 * between two endpoint pages **remounts** this component (verified in-browser — the mount effect
 * logs an unmount of the old slug followed by a mount of the new one), even though both pages are
 * the same route file. So one operation's inputs can't leak onto the next, and the credential
 * restore below runs exactly once per operation.
 *
 * That remount is also why `open` can't be component state alone: it would die on every switch,
 * which is what used to make the in-modal operation switcher close the playground. It lives in the
 * URL instead — see `lib/playground-url.ts`.
 */
export function ApiTryItModal(props: TryItProps) {
  // Starts closed so the server and client trees match; the URL flag is read post-hydration.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (playgroundRequested(window.location.search)) setOpen(true);
  }, []);
  const openPlayground = () => {
    setOpen(true);
    syncPlaygroundUrl(true);
  };
  const onClose = () => {
    setOpen(false);
    syncPlaygroundUrl(false);
  };
  const { method, path, summary, params, auth, specPath } = props;

  const [base, setBase] = useState(props.baseUrl);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [fieldKey(p), p.example ?? ""])),
  );
  // When the spec offers alternatives (Basic *or* Bearer), the reader picks one and only that
  // one's schemes are sent — rendering both would put two values in one `Authorization` header.
  // Credentials for every alternative are kept, so switching back and forth doesn't lose them.
  const allSchemes = useMemo(() => auth.flat(), [auth]);
  const [choice, setChoice] = useState(() => defaultAuthChoice(auth));
  // Clamp: a remembered index can outlive the option list it was chosen from (a soft nav to an
  // operation with fewer alternatives), and `auth[out-of-range]` would render as "no auth needed"
  // — a false statement about a protected endpoint. Memoized so the empty fallback doesn't hand
  // `built` a fresh array identity on every render.
  const schemes = useMemo(
    () => auth[choice] ?? auth[defaultAuthChoice(auth)] ?? [],
    [auth, choice],
  );

  // Credentials are remembered for the tab (sessionStorage) so you type them once, not once per
  // endpoint — this component remounts per operation, so state alone is lost on every navigation.
  // Restored in an effect rather than a lazy initializer: storage doesn't exist during SSR, and
  // seeding state post-mount keeps the server and client trees identical.
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  // Whether *any* credential is stored for this spec, including schemes this operation doesn't
  // use. "Forget" clears the whole entry, so it has to appear whenever there's something to clear
  // — not only when this operation's own fields happen to be filled in.
  const [storedForSpec, setStoredForSpec] = useState(false);
  // Mirror of `authValues` for the event handlers. Two edits landing in one batch (a password
  // manager filling username + password back-to-back) would both read the same stale state off the
  // render closure, losing the first — and persisting the stale copy with it.
  const authValuesRef = useRef(authValues);
  // `location` only exists in the browser, so the scope is resolved at call time, not at render.
  const scope = () => credentialScope(specPath, window.location.pathname);

  // Runs once per mount, and this component is keyed by operation, so it re-runs on every switch.
  useEffect(() => {
    const store = sessionCredentialStore();
    const stored = readCredentials(store, scope(), allSchemes);
    if (Object.keys(stored).length > 0) {
      authValuesRef.current = stored;
      setAuthValues(stored);
    }
    setChoice(readAuthChoice(store, scope(), auth));
    setStoredForSpec(hasStoredCredentials(store, scope()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every credential edit writes through, so the next endpoint page starts filled in.
  const setAuthValue = (key: string, value: string) => {
    const next = { ...authValuesRef.current, [key]: value };
    authValuesRef.current = next;
    setAuthValues(next);
    writeCredentials(sessionCredentialStore(), scope(), allSchemes, next);
    setStoredForSpec(hasStoredCredentials(sessionCredentialStore(), scope()));
  };
  const chooseAuth = (index: number) => {
    setChoice(index);
    writeAuthChoice(sessionCredentialStore(), scope(), auth, index);
  };
  const forgetAuth = () => {
    const cleared = Object.fromEntries(allSchemes.flatMap(authFieldKeys).map((k) => [k, ""]));
    authValuesRef.current = cleared;
    setAuthValues(cleared);
    clearCredentials(sessionCredentialStore(), scope());
    setStoredForSpec(false);
  };
  const [body, setBody] = useState(props.bodySample ?? "");
  const [lang, setLang] = useState<"cURL" | "JavaScript" | "Python">("cURL");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<LiveResponse | null>(null);

  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
  const av = (k: string) => authValues[k] ?? "";

  // Resolve the request from current inputs: substitute path params, collect query + headers,
  // and fold each auth scheme into the right header/query. Shared by Send and the code samples.
  const built = useMemo(() => {
    let url = base + path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = {};
    // One `Cookie` header carries every cookie — from `in: cookie` parameters and cookie-located
    // security schemes alike. A header *named* after the cookie is the shape that 401s.
    const cookies: string[] = [];
    for (const p of params) {
      const v = values[fieldKey(p)]?.trim();
      if (!v) continue;
      if (p.in === "path") url = url.replace(`{${p.name}}`, encodeURIComponent(v));
      else if (p.in === "query") query.set(p.name, v);
      else if (p.in === "cookie") cookies.push(`${p.name}=${v}`);
      else headers[p.name] = v;
    }
    // Headers the reader set explicitly, via a parameter the spec documents. A security scheme
    // must not silently overwrite one: the typed value is a deliberate act, the stored credential
    // is ambient, and the field would go on showing a value the request no longer carries.
    const fromParams = new Set(Object.keys(headers).map((h) => h.toLowerCase()));
    const setHeader = (name: string, value: string) => {
      if (!fromParams.has(name.toLowerCase())) headers[name] = value;
    };
    for (const a of schemes) {
      if (a.type === "basic") {
        const u = av(`${a.key}.username`);
        const pw = av(`${a.key}.password`);
        if (u || pw) setHeader("Authorization", `Basic ${btoaSafe(`${u}:${pw}`)}`);
      } else if (a.type === "bearer" || a.type === "oauth2" || a.type === "other") {
        const t = av(`${a.key}.token`);
        if (t) setHeader("Authorization", `Bearer ${t}`);
      } else if (a.type === "apiKey" && a.name) {
        const v = av(`${a.key}.value`);
        if (v) {
          if (a.in === "query") query.set(a.name, v);
          // Browsers forbid scripts from setting `Cookie` on a fetch, so a live Send won't carry
          // it; the cURL sample beside it is copy-paste surface, and there it's the difference
          // between working and a 401.
          else if (a.in === "cookie") cookies.push(`${a.name}=${v}`);
          else setHeader(a.name, v);
        }
      }
    }
    if (cookies.length) headers["Cookie"] = cookies.join("; ");
    const qs = query.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    const sendBody = hasBody && body.trim() ? body : undefined;
    if (sendBody && !("Content-Type" in headers)) headers["Content-Type"] = "application/json";
    return { url, headers, body: sendBody };
  }, [base, path, params, values, schemes, authValues, body, hasBody]); // eslint-disable-line react-hooks/exhaustive-deps

  const sample = useMemo(() => buildSample(lang, method, built), [lang, method, built]);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(built.url, {
        method,
        headers: built.headers,
        body: built.body,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON */
      }
      setLive({ status: res.status, statusText: res.statusText, body: pretty, ok: res.ok });
    } catch (err) {
      setLive({
        status: 0,
        statusText: "Request failed",
        ok: false,
        body:
          `${(err as Error).message}\n\n` +
          "The endpoint may be unreachable, or it may not allow cross-origin browser requests " +
          "(CORS). Copy the cURL sample and run it from a terminal instead.",
      });
    } finally {
      setSending(false);
    }
  }

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const grouped = {
    path: params.filter((p) => p.in === "path"),
    header: params.filter((p) => p.in === "header"),
    query: params.filter((p) => p.in === "query"),
    cookie: params.filter((p) => p.in === "cookie"),
  };
  const conflicts = authorizationConflicts(schemes);

  const ref = useRef<HTMLDivElement>(null);
  // Built only while open — this is a large tree, and the trigger is on every endpoint page.
  const modal = !open ? null : (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => e.target === ref.current && onClose()}
      ref={ref}
    >
      {/* Always-visible, styled scrollbar for the modal's scroll panes — defining
          ::-webkit-scrollbar opts out of macOS overlay scrollbars (which fade out), so the
          results window's scrollbar is persistently there. Paired with overflow-y-scroll. */}
      <style>{TRY_IT_SCROLL_CSS}</style>
      <div className="my-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
        {/* Header: op selector · editable URL · Send */}
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-4">
          <OpSelect
            method={method}
            summary={summary}
            siblings={props.siblings}
            siteBase={props.siteBase ?? ""}
          />
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5">
            <span className={clsx("rounded px-2 py-0.5 text-xs font-bold", methodColor(method))}>
              {method}
            </span>
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-300 focus:outline-none"
            />
            <span className="shrink-0 font-mono text-sm text-zinc-500">{path}</span>
          </div>
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sending ? "Sending…" : "Send"} {!sending && <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onClose()}
            className="rounded-lg p-2 text-zinc-400 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid max-h-[80vh] gap-6 overflow-y-auto p-5 lg:grid-cols-2">
          {/* Left: editable inputs across every OpenAPI input class */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">{summary}</h2>

            {allSchemes.length > 0 && (
              <Section
                title="Authorization"
                action={
                  hasStoredAuth(allSchemes, authValues) || storedForSpec ? (
                    <button
                      type="button"
                      onClick={forgetAuth}
                      className="shrink-0 text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                    >
                      Forget
                    </button>
                  ) : null
                }
              >
                {/* The spec offers alternatives (`security` is a list of OR-ed requirements) —
                    only the selected one is sent, since two schemes would collide in a single
                    `Authorization` header. */}
                {auth.length > 1 && (
                  <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                    {auth.map((option, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => chooseAuth(i)}
                        aria-pressed={i === choice}
                        className={clsx(
                          "rounded-md px-2.5 py-1 text-xs font-medium",
                          i === choice
                            ? "bg-zinc-800 text-zinc-100"
                            : "text-zinc-400 hover:text-zinc-200",
                        )}
                      >
                        {authOptionLabel(option)}
                      </button>
                    ))}
                  </div>
                )}
                {schemes.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    This endpoint also accepts unauthenticated requests.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-zinc-500">
                      Kept for this browser tab so you don&rsquo;t retype it on every endpoint.
                      Closing the tab forgets it.
                    </p>
                    {/* The spec ANDs two schemes that both write `Authorization`. That header holds
                        one value, so one of them is dropped — say so rather than send a request the
                        reader didn't intend. (Which one survives depends on what's filled in, so
                        the notice doesn't promise an order.) */}
                    {schemes.some((a) => a.type === "apiKey" && a.in === "cookie") && (
                      <p className="text-xs text-zinc-500">
                        Sent as a <code>Cookie</code> header, which browsers don&rsquo;t let a page
                        set — <b>Send</b> won&rsquo;t carry it, but the cURL sample will.
                      </p>
                    )}
                    {conflicts.length > 0 && (
                      <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                        This spec requires {conflicts.join(" and ")} together, but they all go in
                        the <code>Authorization</code> header — it holds one value, so only one of
                        them reaches the API.
                      </p>
                    )}
                    {schemes.map((a) => (
                      <AuthFields key={a.key} auth={a} values={authValues} set={setAuthValue} />
                    ))}
                  </>
                )}
              </Section>
            )}

            {grouped.header.length > 0 && (
              <Section title="Headers">
                {grouped.header.map((f) => (
                  <ParamField key={fieldKey(f)} f={f} values={values} set={setValues} />
                ))}
              </Section>
            )}

            {grouped.path.length > 0 && (
              <Section title="Path">
                {grouped.path.map((f) => (
                  <ParamField key={fieldKey(f)} f={f} values={values} set={setValues} />
                ))}
              </Section>
            )}

            {grouped.query.length > 0 && (
              <Section title="Query">
                {grouped.query.map((f) => (
                  <ParamField key={fieldKey(f)} f={f} values={values} set={setValues} />
                ))}
              </Section>
            )}

            {grouped.cookie.length > 0 && (
              <Section title="Cookies">
                <p className="text-xs text-zinc-500">
                  Browsers don&rsquo;t let a page set the <code>Cookie</code> header, so
                  <b> Send</b> won&rsquo;t carry these — copy the cURL sample and run it from a
                  terminal instead.
                </p>
                {grouped.cookie.map((f) => (
                  <ParamField key={fieldKey(f)} f={f} values={values} set={setValues} />
                ))}
              </Section>
            )}

            {hasBody && (
              <Section title="Body">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={Math.min(14, Math.max(4, body.split("\n").length))}
                  spellCheck={false}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-primary focus:outline-none"
                />
              </Section>
            )}
          </div>

          {/* Right: live request sample + response */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <span className="text-xs font-medium text-zinc-400">{summary}</span>
                <div className="flex items-center gap-1">
                  {(["cURL", "JavaScript", "Python"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLang(l)}
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[0.7rem] font-medium",
                        lang === l ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                  <CopyButton text={sample} />
                </div>
              </div>
              <pre
                className="m-0 overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-200"
                dangerouslySetInnerHTML={{
                  __html: lang === "cURL" ? colorizeShell(sample) : colorizeJsLike(sample),
                }}
              />
            </div>

            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                {live ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[0.65rem] font-bold",
                        live.ok ? "bg-green-950 text-green-300" : "bg-red-950 text-red-300",
                      )}
                    >
                      {live.status || "ERR"}
                    </span>
                    <span className="text-zinc-400">{live.statusText}</span>
                  </span>
                ) : (
                  <span className="text-xs font-medium text-zinc-500">
                    Response — press Send to call the API
                  </span>
                )}
                {live && <CopyButton text={live.body} />}
              </div>
              {live ? (
                <pre
                  className="try-it-scroll m-0 max-h-[40vh] overflow-y-scroll overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-200"
                  dangerouslySetInnerHTML={{ __html: colorizeJson(live.body) }}
                />
              ) : (
                <div className="p-4 text-xs text-zinc-600">No response yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={openPlayground}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Try it <Play className="h-3.5 w-3.5" />
      </button>
      {/* Portaled to <body> so the modal escapes the article's stacking/overflow context. */}
      {modal && createPortal(modal, document.body)}
    </>
  );
}

function OpSelect({
  method,
  summary,
  siblings,
  siteBase,
}: {
  method: string;
  summary: string;
  siblings: TryItSibling[];
  siteBase: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => siblings.length > 0 && setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
      >
        <span className={clsx("rounded px-1.5 py-0.5 text-[0.65rem] font-bold", methodColor(method))}>
          {method}
        </span>
        <span className="text-sm font-medium text-zinc-200">{summary}</span>
        {siblings.length > 0 && <ChevronDown className="h-4 w-4 text-zinc-500" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
          {siblings.map((s) => (
            <Link
              key={s.slug}
              // Carries the flag so the playground is still open on the endpoint you switched to —
              // the page remounts, so this is what survives the hop. Base-prefixed like every
              // other internal link: in apex path mode a bare `/slug` escapes the tenant entirely.
              href={withBase(playgroundHref(s.slug), siteBase)!}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              <span
                className={clsx("rounded px-1.5 py-0.5 text-[0.6rem] font-bold", methodColor(s.method))}
              >
                {s.method}
              </span>
              <span className="truncate">{s.summary}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamField({
  f,
  values,
  set,
}: {
  f: TryItParam;
  values: Record<string, string>;
  set: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <Field
      label={f.name}
      type={f.type}
      required={f.required}
      description={f.description}
      value={values[fieldKey(f)] ?? ""}
      onChange={(v) => set((s) => ({ ...s, [fieldKey(f)]: v }))}
      placeholder={f.example ?? `enter ${f.name}`}
    />
  );
}

/** Any credential currently filled in — gates the "Forget" control so it only shows when there's
 *  something to forget. */
function hasStoredAuth(auth: TryItAuth[], values: Record<string, string>): boolean {
  return auth.flatMap(authFieldKeys).some((k) => (values[k] ?? "") !== "");
}

function AuthFields({
  auth,
  values,
  set,
}: {
  auth: TryItAuth;
  values: Record<string, string>;
  set: (key: string, value: string) => void;
}) {
  const upd = (k: string) => (v: string) => set(k, v);
  if (auth.type === "basic") {
    return (
      <>
        {auth.description && <p className="text-xs text-zinc-400">{auth.description}</p>}
        <Field
          label={`${auth.key}.username`}
          type="string"
          required
          value={values[`${auth.key}.username`] ?? ""}
          onChange={upd(`${auth.key}.username`)}
          placeholder="username"
        />
        <Field
          label={`${auth.key}.password`}
          type="string"
          required
          secret
          value={values[`${auth.key}.password`] ?? ""}
          onChange={upd(`${auth.key}.password`)}
          placeholder="password"
        />
      </>
    );
  }
  if (auth.type === "apiKey") {
    return (
      <Field
        label={auth.name ?? auth.key}
        type={`apiKey · ${auth.in ?? "header"}`}
        required
        description={auth.description}
        value={values[`${auth.key}.value`] ?? ""}
        onChange={upd(`${auth.key}.value`)}
        placeholder="key"
        mono
        secret
      />
    );
  }
  // bearer / oauth2 / other → a single token sent as `Authorization: Bearer …`
  return (
    <Field
      label={`${auth.key} token`}
      // `bearerFormat` is free text in the spec (JWT being the common one) — a hint about what to
      // paste, so show it when the author bothered to declare it.
      type={
        auth.type === "oauth2"
          ? "oauth2 · access token"
          : auth.format
            ? `bearer · ${auth.format}`
            : "bearer"
      }
      required
      description={auth.description}
      value={values[`${auth.key}.token`] ?? ""}
      onChange={upd(`${auth.key}.token`)}
      placeholder="token"
      mono
      secret
    />
  );
}

// ---- code sample generation (client) ----
/**
 * Base64 for the Basic header. `btoa` only accepts Latin-1, so a password containing `é` (or any
 * non-Latin1 character) used to throw and fall through to returning the credential **unencoded** —
 * an Authorization header that both fails to authenticate and puts the raw password on the wire.
 * UTF-8-encode first, which is what RFC 7617 asks for.
 */
function btoaSafe(s: string): string {
  try {
    const utf8 = new TextEncoder().encode(s);
    let binary = "";
    for (const byte of utf8) binary += String.fromCharCode(byte);
    return typeof btoa === "function" ? btoa(binary) : Buffer.from(s, "utf8").toString("base64");
  } catch {
    return s;
  }
}

function buildSample(
  lang: "cURL" | "JavaScript" | "Python",
  method: string,
  req: { url: string; headers: Record<string, string>; body?: string },
): string {
  const entries = Object.entries(req.headers);
  if (lang === "cURL") {
    // Every interpolated value is shell-quoted: these carry real reader input (a path value, a
    // password), so an `&`, a `<`, or an apostrophe would otherwise break the pasted command.
    const lines = [`curl --request ${method} \\`, `  --url ${shellQuote(req.url)}`];
    for (const [k, v] of entries)
      lines[lines.length - 1] += ` \\\n  --header ${shellQuote(`${k}: ${v}`)}`;
    if (req.body) lines[lines.length - 1] += ` \\\n  --data ${shellQuote(req.body)}`;
    return lines.join("");
  }
  if (lang === "JavaScript") {
    // JSON.stringify, not bare quotes — a value containing a `"` would otherwise end the string.
    const h = entries.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
    const opts = [`  method: "${method}",`];
    if (entries.length) opts.push(`  headers: {\n${h}\n  },`);
    if (req.body) opts.push(`  body: ${JSON.stringify(req.body)},`);
    return `const response = await fetch(${JSON.stringify(req.url)}, {\n${opts.join("\n")}\n});\nconst data = await response.json();`;
  }
  // Same reason as JavaScript: a quote in a value must not end the string literal.
  const h = entries
    .map(([k, v]) => `        ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  const args = [`    ${JSON.stringify(req.url)},`];
  if (entries.length) args.push(`    headers={\n${h}\n    },`);
  if (req.body) args.push(`    data=${JSON.stringify(req.body)},`);
  return `import requests\n\nresponse = requests.${method.toLowerCase()}(\n${args.join("\n")}\n)\nprint(response.json())`;
}

// JS/Python share enough surface that the JSON colorizer reads fine for them too (strings,
// numbers, keywords) without a full grammar.
function colorizeJsLike(src: string): string {
  return escapeHtml(src)
    .replace(/("(?:\\.|[^"\\])*")/g, '<span class="text-amber-300">$1</span>')
    .replace(/\b(await|const|async|import|def|print|method|headers|body|data)\b/g, '<span class="text-sky-300">$1</span>');
}
