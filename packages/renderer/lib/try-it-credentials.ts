/**
 * Credential persistence for the "Try it" playground.
 *
 * Each endpoint page mounts its own `ApiTryItModal`, so credentials held in component state die
 * on every navigation — a reader with a Basic-auth spec retypes username + password for every
 * single operation. These helpers remember them for the tab instead.
 *
 * `sessionStorage` is the deliberate choice over `localStorage`: it survives navigation between
 * endpoints (the actual pain) but is scoped to the tab and cleared when that tab closes, so a
 * shared machine doesn't keep API credentials around the way a `localStorage` entry would. Note
 * it is *not* a memory-only store — browsers back session storage on disk for crash/tab restore —
 * so this bounds the lifetime, it doesn't make the credential unrecoverable.
 *
 * It is also not an isolation boundary: any script on the origin can read every key here, so the
 * scoping below is about not prefilling the wrong site's credentials, not about defending one
 * site's credentials from another's page code.
 *
 * Entries are keyed by a **scope** (`credentialScope`) rather than by origin alone — see there for
 * why the spec path isn't enough.
 *
 * Pure by design (the store and the current path are injected) so it unit-tests without a browser
 * — see `tests/unit/try-it-credentials.test.ts`.
 */

/** The scheme shape the playground renders inputs for (mirrors `AuthScheme` in `lib/openapi.ts`,
 *  declared here so client components can import it without pulling in a `server-only` module). */
export type TryItAuth = {
  key: string;
  type: "basic" | "bearer" | "apiKey" | "oauth2" | "other";
  in?: "header" | "query" | "cookie";
  name?: string;
  format?: string;
  description?: string;
};

/** The slice of `Storage` we need — injected so the logic stays pure and testable. */
export type CredentialStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The field keys a scheme's inputs read and write. Single source of truth for the inputs, the
 *  request builder, and what gets persisted — they must not drift. */
export function authFieldKeys(auth: TryItAuth): string[] {
  if (auth.type === "basic") return [`${auth.key}.username`, `${auth.key}.password`];
  if (auth.type === "apiKey") return [`${auth.key}.value`];
  return [`${auth.key}.token`]; // bearer / oauth2 / other
}

/**
 * Who these credentials belong to: the tenant **and** the spec.
 *
 * `sessionStorage` is per-origin, which equals per-tenant in subdomain mode — but in apex path
 * mode (`/sites/{slug}`) every tenant shares one origin, and a spec path like `openapi.json` is
 * common enough that two tenants would land on the same key and prefill each other's credentials.
 * Mixing the `/sites/{slug}` prefix in keeps them apart; the spec path keeps two specs on one site
 * apart. Takes the pathname as an argument so it stays pure and testable.
 *
 * A site whose own docs live under `/sites/…` reads as a tenant prefix here. The cost is that its
 * credentials don't carry to its other pages — it asks for a retype, it never leaks — which is the
 * right way round for a mistake to land.
 */
export function credentialScope(specPath: string, pathname: string): string {
  const tenant = /^\/sites\/([^/]+)/.exec(pathname)?.[1] ?? "";
  return `${tenant}|${specPath}`;
}

export function storageKey(scope: string): string {
  return `papervine:try-it-auth:${scope}`;
}

function choiceKey(scope: string): string {
  return `papervine:try-it-auth-choice:${scope}`;
}

/**
 * Schemes in one alternative that would all write the `Authorization` header. An AND requirement
 * combining, say, Basic *and* Bearer can't actually be sent — one header, one value — so only one
 * of them reaches the API. We surface that rather than quietly sending a request the reader didn't
 * intend.
 *
 * Mirrors the request builder: an apiKey collides only when it's named `Authorization` *and* lands
 * in the header. One sent as a query parameter — or as a cookie, which the builder folds into
 * `Cookie` — shares nothing with it but the name, and warning about those is a false alarm.
 */
export function authorizationConflicts(schemes: TryItAuth[]): string[] {
  const onAuthHeader = schemes.filter(
    (s) =>
      s.type !== "apiKey" ||
      ((s.in ?? "header") === "header" && /^authorization$/i.test(s.name ?? "")),
  );
  return onAuthHeader.length > 1 ? onAuthHeader.map((s) => s.key) : [];
}

/**
 * Label for one alternative in a spec's `security` list — the scheme names it requires, since
 * those are what the spec author wrote and what the reader sees in the fields below. An
 * alternative requiring nothing is OpenAPI's "this endpoint also works unauthenticated".
 */
export function authOptionLabel(schemes: TryItAuth[]): string {
  return schemes.length === 0 ? "No auth" : schemes.map((s) => s.key).join(" + ");
}

/**
 * Which alternative to show, remembered per spec: picking "Bearer" on one endpoint and landing
 * back on "Basic" at the next one is the same annoyance as retyping the credential.
 *
 * Stored as the label, not the index, so reordering the spec's `security` list doesn't silently
 * select a different scheme; an unknown label falls back to `defaultAuthChoice`.
 */
export function readAuthChoice(
  store: CredentialStore | null,
  scope: string,
  options: TryItAuth[][],
): number {
  if (!store || options.length === 0) return defaultAuthChoice(options);
  let stored: string | null = null;
  try {
    stored = store.getItem(choiceKey(scope));
  } catch {
    return defaultAuthChoice(options);
  }
  if (!stored) return defaultAuthChoice(options);
  const i = options.findIndex((schemes) => authOptionLabel(schemes) === stored);
  return i === -1 ? defaultAuthChoice(options) : i;
}

/**
 * The alternative to start on: the first one that actually asks for a credential.
 *
 * Index 0 is the wrong default for the common "auth optional" shape `security: [{}, {Bearer}]` —
 * it would land on **No auth**, render no fields, and quietly send an unauthenticated request from
 * a reader who has a token. Picking "No auth" explicitly is still remembered, since that's stored
 * by label.
 */
export function defaultAuthChoice(options: TryItAuth[][]): number {
  const i = options.findIndex((schemes) => schemes.length > 0);
  return i === -1 ? 0 : i;
}

export function writeAuthChoice(
  store: CredentialStore | null,
  scope: string,
  options: TryItAuth[][],
  index: number,
): void {
  const schemes = options[index];
  if (!store || !schemes) return;
  try {
    store.setItem(choiceKey(scope), authOptionLabel(schemes));
  } catch {
    /* see writeCredentials — remembering is never a hard failure */
  }
}

/** `sessionStorage`, or null when it's unavailable (SSR, or a browser with storage disabled —
 *  Safari private mode throws on access, not just on write). */
export function sessionCredentialStore(): CredentialStore | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Stored credentials for these schemes. Only keys the schemes actually declare are returned, so
 * a stale entry from an earlier version of the spec can't inject fields the playground would then
 * fold into a request.
 */
export function readCredentials(
  store: CredentialStore | null,
  scope: string,
  schemes: TryItAuth[],
): Record<string, string> {
  if (!store || schemes.length === 0) return {};
  const stored = readStored(store, scope);
  const out: Record<string, string> = {};
  for (const key of schemes.flatMap(authFieldKeys)) {
    if (stored[key]) out[key] = stored[key];
  }
  return out;
}

/**
 * Whether anything is stored for this scope at all — including schemes the current operation
 * doesn't use. Gates the "Forget" control, which clears the whole entry: an operation whose own
 * fields are empty can still be the page a reader is on when they want the spec's other
 * credentials gone.
 */
export function hasStoredCredentials(store: CredentialStore | null, scope: string): boolean {
  return store ? Object.keys(readStored(store, scope)).length > 0 : false;
}

/** Every string field in the entry, unfiltered. Internal: callers get the scheme-filtered view. */
function readStored(store: CredentialStore, scope: string): Record<string, string> {
  let parsed: unknown;
  try {
    const raw = store.getItem(storageKey(scope));
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {}; // unreadable storage or corrupt entry — start clean rather than throw
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Persist the credential fields these schemes declare, **merged into** what's already stored.
 *
 * Merging is load-bearing, not tidiness: one spec's operations can require different schemes (an
 * operation-level `security` override beats the root's), so each modal only knows about its own
 * operation's schemes. Replacing the entry would let saving a token on operation B wipe the API key
 * the reader entered on operation A — and clearing B's last field would delete the whole entry.
 * A scheme's own field going empty still removes that field, so clearing what you see clears what's
 * stored, and an entry with nothing left is removed outright.
 */
export function writeCredentials(
  store: CredentialStore | null,
  scope: string,
  schemes: TryItAuth[],
  values: Record<string, string>,
): void {
  if (!store) return;
  const merged = readStored(store, scope);
  for (const key of schemes.flatMap(authFieldKeys)) {
    const v = values[key];
    if (typeof v === "string" && v !== "") merged[key] = v;
    else delete merged[key];
  }
  try {
    if (Object.keys(merged).length === 0) store.removeItem(storageKey(scope));
    else store.setItem(storageKey(scope), JSON.stringify(merged));
  } catch {
    /* quota or disabled storage — remembering is a convenience, never a hard failure */
  }
}

/** Forget every credential for this scope — including other operations' schemes, which is what a
 *  reader means by "Forget". */
export function clearCredentials(store: CredentialStore | null, scope: string): void {
  if (!store) return;
  try {
    store.removeItem(storageKey(scope));
  } catch {
    /* ignore */
  }
}
