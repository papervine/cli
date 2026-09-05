import type { DocsConfig } from "./config";

/**
 * Normalized assistant settings from docs.json (and the same shape the hosted
 * dashboard writes). Kept pure so the panel, the system prompt, and the
 * allowlisted fetch tools share one definition — and so the fiddly parsing
 * (toggles, shorthand email, domain filters) can be unit-tested without a
 * request.
 *
 * The raw `assistant` block is intentionally loose: a single unexpected field
 * must not 500 the site (the warn-don't-throw rule). This module is the one
 * place that turns that bag into something the rest of the assistant can trust.
 */

export type AssistantDeflection = {
  enabled: true;
  email: string;
  /** Persistent "Contact support" control in the chat chrome. */
  showHelpButton: boolean;
};

/** A Mintlify-compatible search-domain filter: host (or `*.host`) plus optional path prefix. */
export type SearchDomainPattern = {
  /** Hostname, or `*.example.com` to match every subdomain (and the apex). */
  host: string;
  /** Path prefix including the leading slash, or empty for the whole host. */
  pathPrefix: string;
};

export type AssistantSettings = {
  deflection: AssistantDeflection | null;
  searchDomains: SearchDomainPattern[];
};

const EMPTY: AssistantSettings = { deflection: null, searchDomains: [] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSupportEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Pull a usable support address out of the several places the dashboard / docs.json
 * can stash it. Empty or malformed values are treated as "not configured" rather
 * than an error — a typo must not take the assistant down.
 */
function pickEmail(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (isSupportEmail(c)) return (c as string).trim();
  }
  return null;
}

/**
 * Parse `assistant.searchDomains` entries.
 *
 * Mintlify's filter syntax (and the dashboard screenshot's placeholder):
 *   `example.com`              — that host only
 *   `docs.example.com`         — that subdomain only
 *   `*.example.com`            — every subdomain, and the apex
 *   `docs.example.com/api`     — that host, only paths under `/api`
 *
 * A scheme, credentials, query, or hash are stripped if someone pastes a full URL.
 * Private / loopback hosts are refused even if listed — the fetch tool must not
 * become an SSRF trampoline because a docs.json had `127.0.0.1` in it.
 */
export function parseSearchDomain(raw: string): SearchDomainPattern | null {
  let s = raw.trim();
  if (!s) return null;
  // A pasted URL is fine (`https://docs.example.com/api`); `*.example.com` is not
  // a legal URL host, so strip the scheme by hand rather than going through `URL`.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    try {
      const url = new URL(s.replace("://*.", "://wildcard."));
      if (url.username || url.password) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      const wildcard = /:\/\/\*\./.test(s);
      const host = (wildcard ? `*.${url.hostname.replace(/^wildcard\./i, "")}` : url.hostname)
        .toLowerCase()
        .replace(/\.$/, "");
      const pathPrefix = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
      if (!host || isBlockedHost(host.replace(/^\*\./, ""))) return null;
      return { host, pathPrefix };
    } catch {
      return null;
    }
  }
  s = s.replace(/[?#].*$/, "");
  const slash = s.indexOf("/");
  const host = (slash === -1 ? s : s.slice(0, slash)).toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  const pathPrefix = slash === -1 ? "" : s.slice(slash).replace(/\/+$/, "");
  if (!host || isBlockedHost(host.replace(/^\*\./, ""))) return null;
  return { host, pathPrefix: pathPrefix === "/" ? "" : pathPrefix };
}

export function formatSearchDomain(pattern: SearchDomainPattern): string {
  return pattern.host + pattern.pathPrefix;
}

/**
 * Hosts the fetch tool must never contact, even if they appear in docs.json.
 * The assistant runs on the operator's machine (CLI) or a shared worker
 * (hosted); either way, a listed domain is an instruction to make an outbound
 * request, and localhost / link-local / RFC1918 are not "public sites".
 */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "metadata.google.internal" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan")
  ) {
    return true;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split(".").map(Number);
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function hostMatchesPattern(hostname: string, patternHost: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  const p = patternHost.toLowerCase();
  if (p.startsWith("*.")) {
    const apex = p.slice(2);
    return h === apex || h.endsWith(`.${apex}`);
  }
  return h === p;
}

export function urlMatchesPattern(url: URL, pattern: SearchDomainPattern): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (isBlockedHost(url.hostname)) return false;
  if (!hostMatchesPattern(url.hostname, pattern.host)) return false;
  if (!pattern.pathPrefix) return true;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return path === pattern.pathPrefix || path.startsWith(`${pattern.pathPrefix}/`);
}

export function urlMatchesAny(url: URL, patterns: SearchDomainPattern[]): boolean {
  return patterns.some((p) => urlMatchesPattern(url, p));
}

/**
 * Build a `mailto:` that opens the reader's mail client with the unanswered
 * question (and the page they were on) already filled in. Used by both the
 * persistent help button and the post-answer deflection CTA.
 */
export function deflectionMailto(
  email: string,
  opts: { question?: string; pageUrl?: string } = {},
): string {
  const params = new URLSearchParams();
  params.set("subject", "Documentation question");
  const lines = ["I have a question that the docs assistant couldn't answer."];
  if (opts.question?.trim()) {
    lines.push("", "Question:", opts.question.trim());
  }
  if (opts.pageUrl?.trim()) {
    lines.push("", `Page: ${opts.pageUrl.trim()}`);
  }
  params.set("body", lines.join("\n"));
  return `mailto:${email}?${params.toString()}`;
}

export function assistantSettingsFromConfig(
  config: Pick<DocsConfig, "assistant"> | null | undefined,
): AssistantSettings {
  const raw = asRecord(config?.assistant);
  if (!raw) return EMPTY;

  const deflectionBag = raw.deflection;
  const deflectionObj = asRecord(deflectionBag);
  const email = pickEmail(raw.supportEmail, deflectionObj?.email);
  const showHelpButton =
    typeof raw.showHelpButton === "boolean"
      ? raw.showHelpButton
      : typeof deflectionObj?.showHelpButton === "boolean"
        ? deflectionObj.showHelpButton
        : false;
  const deflectionOff =
    deflectionBag === false ||
    deflectionBag === 0 ||
    deflectionObj?.enabled === false;
  const deflection: AssistantDeflection | null =
    !deflectionOff && email ? { enabled: true, email, showHelpButton } : null;

  const domainsBag = raw.searchDomains;
  const domainsObj = asRecord(domainsBag);
  const domainStrings = Array.isArray(domainsBag)
    ? asStringList(domainsBag)
    : asStringList(domainsObj?.domains);
  const domainsOff = domainsObj?.enabled === false;
  const searchDomains = domainsOff
    ? []
    : domainStrings
        .map(parseSearchDomain)
        .filter((p): p is SearchDomainPattern => p !== null);

  return { deflection, searchDomains };
}
