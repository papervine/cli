import "server-only";
import {
  formatSearchDomain,
  urlMatchesAny,
  type SearchDomainPattern,
} from "./assistant-settings";

/**
 * Extra-site retrieval for the assistant (docs.json `assistant.searchDomains`).
 *
 * The model already has `searchDocs` / `readPage` over this site. These tools
 * cover *other* public hosts the owner listed — a pricing page, a status site,
 * a second docs subdomain — so an answer can cite them when the local corpus
 * doesn't cover the question.
 *
 * There is no web-search API here (the CLI has none, and the hosted product
 * must not depend on one for this path). Discovery is: fetch `llms.txt` and
 * `sitemap.xml` on each listed host, score what we find against the query,
 * and let the model `readUrl` a hit. Pages that need JavaScript to render
 * will come back thin; that's the same caveat Mintlify documents.
 *
 * Every URL is re-checked against the allowlist *after* redirects, and
 * private hosts are refused in the matcher — this is an outbound fetch the
 * operator configured, not an open proxy.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type SearchSiteHit = {
  title: string;
  url: string;
  snippet: string;
};

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 400_000;
const MAX_HITS = 8;
const FETCH_HEADERS = {
  accept: "text/html, text/plain, application/xml, application/xhtml+xml, */*",
  "user-agent": "PapervineAssistant/1.0",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function sitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

export function markdownHrefs(md: string): string[] {
  const out: string[] = [];
  const re = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

export function scoreText(text: string, query: string): { score: number; snippet: string } {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const lower = text.toLowerCase();
  let score = 0;
  let first = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0) {
      score += 1;
      if (first < 0 || i < first) first = i;
    }
  }
  const start = Math.max(0, (first < 0 ? 0 : first) - 80);
  const snippet = text.slice(start, start + 240).replace(/\s+/g, " ").trim();
  return { score, snippet };
}

/** Candidate discovery URLs for one filter. Wildcard hosts try the apex and `www`. */
export function discoveryUrls(pattern: SearchDomainPattern): string[] {
  const hosts = pattern.host.startsWith("*.")
    ? [pattern.host.slice(2), `www.${pattern.host.slice(2)}`]
    : [pattern.host];
  const urls: string[] = [];
  for (const host of hosts) {
    const origin = `https://${host}`;
    if (pattern.pathPrefix) {
      urls.push(`${origin}${pattern.pathPrefix}/llms.txt`);
      urls.push(`${origin}${pattern.pathPrefix}`);
    }
    urls.push(`${origin}/llms.txt`);
    urls.push(`${origin}/sitemap.xml`);
    if (!pattern.pathPrefix) urls.push(`${origin}/`);
  }
  return [...new Set(urls)];
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.replace(/\/+$/, "").split("/").pop();
    return last || u.hostname;
  } catch {
    return url;
  }
}

async function fetchAllowed(
  url: string,
  patterns: SearchDomainPattern[],
  fetchImpl: FetchLike,
): Promise<{ url: string; contentType: string; text: string } | { error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Not a valid URL." };
  }
  if (!urlMatchesAny(parsed, patterns)) {
    return { error: "URL is not on a configured search domain." };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(parsed.href, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: FETCH_HEADERS,
    });
    const finalHref = res.url || parsed.href;
    let finalUrl: URL;
    try {
      finalUrl = new URL(finalHref);
    } catch {
      return { error: "Redirect produced an unparseable URL." };
    }
    if (!urlMatchesAny(finalUrl, patterns)) {
      return { error: "Redirect left the allowed domains." };
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    const sliced = buf.byteLength > MAX_BYTES ? buf.subarray(0, MAX_BYTES) : buf;
    const text = new TextDecoder("utf-8").decode(sliced);
    return {
      url: finalUrl.href,
      contentType: res.headers.get("content-type") ?? "",
      text,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fetch failed." };
  } finally {
    clearTimeout(timer);
  }
}

function toPlain(contentType: string, text: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("html")) return htmlToText(text);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Discover pages on the listed domains and return the ones that look relevant
 * to `query`. Failures on individual hosts are skipped — one dead extra site
 * must not fail the turn.
 */
export async function searchSite(
  query: string,
  patterns: SearchDomainPattern[],
  fetchImpl: FetchLike = fetch,
): Promise<SearchSiteHit[] | { error: string }> {
  if (!patterns.length) return { error: "No search domains are configured." };
  const q = query.trim();
  if (!q) return { error: "Query is empty." };

  const candidates = new Map<string, SearchSiteHit>();
  const add = (url: string, title: string, snippet: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!urlMatchesAny(parsed, patterns)) return;
    const href = parsed.href;
    const prev = candidates.get(href);
    if (prev && (prev.snippet?.length ?? 0) >= snippet.length) return;
    candidates.set(href, { title: title || titleFromUrl(href), url: href, snippet });
  };

  await Promise.all(
    patterns.flatMap((pattern) =>
      discoveryUrls(pattern).map(async (url) => {
        const got = await fetchAllowed(url, patterns, fetchImpl);
        if ("error" in got) return;
        const plain = toPlain(got.contentType, got.text);
        const self = scoreText(`${got.url} ${plain}`, q);
        add(got.url, titleFromUrl(got.url), self.snippet || plain.slice(0, 240));

        const linked = got.contentType.includes("xml")
          ? sitemapLocs(got.text)
          : markdownHrefs(got.text);
        for (const loc of linked.slice(0, 40)) {
          const scored = scoreText(loc, q);
          add(loc, titleFromUrl(loc), scored.snippet || loc);
        }
      }),
    ),
  );

  const hits = [...candidates.values()];
  hits.sort((a, b) => {
    const sa = scoreText(`${a.title} ${a.url} ${a.snippet}`, q).score;
    const sb = scoreText(`${b.title} ${b.url} ${b.snippet}`, q).score;
    return sb - sa;
  });
  return hits.slice(0, MAX_HITS);
}

export async function readAllowedUrl(
  url: string,
  patterns: SearchDomainPattern[],
  fetchImpl: FetchLike = fetch,
): Promise<{ url: string; title: string; body: string } | { error: string }> {
  if (!patterns.length) return { error: "No search domains are configured." };
  const got = await fetchAllowed(url, patterns, fetchImpl);
  if ("error" in got) return got;
  const body = toPlain(got.contentType, got.text).slice(0, 8_000);
  return { url: got.url, title: titleFromUrl(got.url), body };
}

export function searchDomainsPrompt(patterns: SearchDomainPattern[]): string {
  return patterns.map(formatSearchDomain).join(", ");
}
