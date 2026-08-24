import "server-only";
import { cache } from "react";
import { AsyncLocalStorage } from "node:async_hooks";
import { create, insertMultiple, search as oramaSearch } from "@orama/orama";
import { listPageSlugs, loadPage, loadConfig } from "./content";
import { buildNav, findGroupLabel } from "./nav";

/**
 * Whether a reader may see a page, given its gate. Injected rather than imported: the
 * hosted app has reader-auth groups to enforce (SPEC §11.2), the CLI has no readers at
 * all. Defaults to allowing everything, which is what a local previewer wants.
 */
export type PageAccessPredicate = (page: { groups: string[]; public: boolean }) => boolean;

const ALLOW_ALL: PageAccessPredicate = () => true;

/**
 * Full-text search index (SPEC.md §6). Each docs page is split into heading
 * sections so a hit can jump straight to the relevant anchor — like hosted docs platforms.
 *
 * The index is built from the same content source the renderer reads, so at M2
 * this builder runs once at sync time per tenant; today it's memoized per request
 * (React `cache`) so it stays fresh as you edit docs in `papervine dev`.
 */
const schema = {
  title: "string",
  section: "string",
  heading: "string",
  content: "string",
  href: "string",
  // Reader-auth gating (SPEC §11.2). The index is reader-INDEPENDENT (one per content
  // source, memoized below); we carry each section's gate here and filter per request in
  // `runSearch` against the reader's access predicate, so gated pages never leak through
  // search/RAG/MCP to a reader who can't open them. `groups` is JSON; `public` is "1"/"".
  groups: "string",
  public: "string",
} as const;

export type SearchHit = {
  title: string;
  section: string;
  heading: string;
  href: string;
  snippet: string;
};

function titleFromSlug(slug: string): string {
  const last = slug.split("/").pop() || slug || "Home";
  return last
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Same slug algorithm as the TOC, so hrefs match rendered heading ids. */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Reduce MDX/Markdown to plain, searchable text. */
function stripMarkdown(s: string): string {
  return s
    .replace(/^import\s.*$/gm, " ") // mdx imports
    .replace(/<[^>]+>/g, " ") // JSX / HTML tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/[#>*_`~|]/g, " ") // markdown punctuation
    .replace(/\s+/g, " ")
    .trim();
}

type Section = { heading: string; id: string; lines: string[] };

/** Split a page body into sections at H2/H3 boundaries (code fences ignored). */
function splitSections(body: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "", id: "", lines: [] };
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    const match = !inFence && /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current.heading || current.lines.length) sections.push(current);
      const heading = match[2].replace(/[*_`]/g, "");
      current = { heading, id: slugifyHeading(heading), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

async function buildIndexUncached() {
  const db = await create({ schema });
  const config = await loadConfig();
  const nav = await buildNav(config);

  // Enumerate pages from the content source AND the nav. `listPageSlugs` is empty for
  // the live-GitHub source (it doesn't pre-walk the repo over the network), so without
  // the nav fallback search would index nothing for any not-yet-synced tenant. Union +
  // dedupe so synced sources (which list real files) also keep nav-only pages. Nav also
  // yields OpenAPI operation hrefs, but `loadPage` returns null for those and they're
  // skipped below.
  const navSlugs = nav
    .flatMap((s) => s.hrefs)
    .map((h) => h.replace(/^\//, ""))
    .map((s) => (s === "index" ? "" : s));
  const slugs = Array.from(new Set([...(await listPageSlugs()), ...navSlugs]));

  // Fetch every page concurrently — sequential `await loadPage` per slug turned a cold
  // index build into one S3/R2 round-trip per page, back-to-back (the "first search is
  // slow" report). Pages are independent reads, so there's nothing to gain from serializing.
  const pages = await Promise.all(slugs.map((slug) => loadPage(slug)));

  const docs: Array<Record<string, string>> = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const page = pages[i];
    if (!page || page.frontmatter.hidden || page.frontmatter.noindex) continue;

    const baseHref = "/" + (slug || "index");
    const title = page.frontmatter.title ?? titleFromSlug(slug);
    const section = findGroupLabel(nav, baseHref) ?? "";
    // Per-page gate, carried on every section of the page (filtered in runSearch).
    const groups = JSON.stringify(page.frontmatter.groups ?? []);
    const isPublic = page.frontmatter.public ? "1" : "";

    for (const part of splitSections(page.body)) {
      const text = stripMarkdown(part.lines.join("\n"));
      if (part.heading) {
        docs.push({ title, section, heading: part.heading, content: text, href: `${baseHref}#${part.id}`, groups, public: isPublic });
      } else {
        // Intro section carries the page title + description so a page is findable
        // by name even when its first prose is thin.
        const content = [page.frontmatter.description, text].filter(Boolean).join(" ");
        docs.push({ title, section, heading: "", content, href: baseHref, groups, public: isPublic });
      }
    }
  }

  await insertMultiple(db, docs);
  return db;
}

/**
 * Reuse the built Orama index ACROSS requests, in-process, keyed by content version. The index is
 * reader-independent (the per-page gate is applied per query in `runSearch`) and changes only on
 * (re-)sync, yet building it re-reads every page — so rebuilding it per request (React `cache`
 * alone) re-read the whole site on every keystroke (the "search got slow" report). With a version
 * key the build happens once per version per process; queries just hit the warm index. A re-sync
 * changes the key (new sha/updatedAt) → fresh index. No key (apex / `papervine dev`, where content
 * is edited live with no stable version) falls back to the per-request build so edits stay fresh.
 */
const perRequestIndex = cache(buildIndexUncached);

/**
 * The version→index cache, hung off `globalThis` rather than kept as a module local.
 *
 * A module-level `Map` assumes one module instance per process, and the bundler does not
 * guarantee that: Turbopack emitted the search module into **two** server chunks, so the CLI's
 * startup warmer and the `/api/search` route each got their own copy — and their own cache. The
 * warmer dutifully built an index the route could never see, which looked exactly like warming
 * not working at all (first search still paid the full ~270ms build on a 500-page repo).
 *
 * A `Symbol.for` key is shared across every copy in the process, so they all use one cache. The
 * entries are content-addressed, so a stale one from a previous dev reload simply never matches.
 */
const CACHE_KEY = Symbol.for("papervine.search.indexByVersion");
type IndexCache = Map<string, ReturnType<typeof buildIndexUncached>>;
const globalCache = globalThis as typeof globalThis & { [CACHE_KEY]?: IndexCache };
const indexByVersion: IndexCache = (globalCache[CACHE_KEY] ??= new Map());
const MAX_CACHED_INDEXES = 32; // bound a long-lived multi-tenant process; evict the oldest

// The version key also rides an AsyncLocalStorage so the retrieval surfaces that call `runSearch`
// indirectly (the assistant + MCP, via docs-tools.searchDocs) get the cross-request cache too,
// without threading the key through every tool call — mirroring how `contentContext`/the reader
// `accessContext` reach those same streamed tool calls. Live routes set it; DRAFT routes (the
// editor/authoring agents, whose content changes live) deliberately don't, so they stay per-request.
const searchKeyContext = new AsyncLocalStorage<string | null>();

/** Run `fn` with `key` as the search index version for any nested `runSearch` (set by live RAG
 *  routes alongside `contentContext`). Pass null to force the per-request build (drafts). */
export function withSearchIndexKey<T>(key: string | null, fn: () => T): T {
  return searchKeyContext.run(key, fn);
}

/**
 * Build and cache the index for `indexKey` without searching it.
 *
 * `runSearch` returns early on an empty term — before it ever reaches the index — so there is no
 * way to warm the cache through it without inventing a fake query. Callers that know a search is
 * *coming* (the CLI, which warms at startup and again whenever the previewed files change) use
 * this instead, so the reader's first keystroke hits a built index rather than paying for the
 * build.
 *
 * Resolves either way: warming is an optimisation, and a failure here must not take down the
 * caller. A failed build is not cached (see `getIndex`), so the lazy path simply retries.
 */
export async function warmSearchIndex(indexKey: string | null | undefined): Promise<boolean> {
  try {
    await getIndex(indexKey);
    return true;
  } catch {
    return false;
  }
}

function getIndex(indexKey: string | null | undefined): ReturnType<typeof buildIndexUncached> {
  const key = indexKey ?? searchKeyContext.getStore() ?? null;
  if (!key) return perRequestIndex();
  const hit = indexByVersion.get(key);
  if (hit) {
    indexByVersion.delete(key); // re-insert to mark most-recently-used (LRU)
    indexByVersion.set(key, hit);
    return hit;
  }
  if (indexByVersion.size >= MAX_CACHED_INDEXES) {
    indexByVersion.delete(indexByVersion.keys().next().value as string);
  }
  const built = buildIndexUncached().catch((err) => {
    indexByVersion.delete(key); // never cache a failed build
    throw err;
  });
  indexByVersion.set(key, built);
  return built;
}

/** Build a short snippet centered on the first matched term. */
function makeSnippet(content: string, term: string, len = 140): string {
  if (!content) return "";
  const lower = content.toLowerCase();
  const first = term.toLowerCase().split(/\s+/).find((t) => lower.includes(t));
  const at = first ? lower.indexOf(first) : 0;
  const start = Math.max(0, at - 50);
  const slice = content.slice(start, start + len).trim();
  return (start > 0 ? "…" : "") + slice + (start + len < content.length ? "…" : "");
}

export async function runSearch(
  term: string,
  opts: { indexKey?: string | null; limit?: number; access?: PageAccessPredicate } = {},
): Promise<SearchHit[]> {
  if (!term.trim()) return [];
  const { indexKey, limit = 8, access = ALLOW_ALL } = opts;
  const db = await getIndex(indexKey);
  // Over-fetch so the reader-access filter below can drop gated hits without under-filling
  // the result list (a reader who can see most pages should still get `limit` hits).
  const res = await oramaSearch(db, {
    term,
    properties: ["title", "heading", "content"],
    boost: { title: 4, heading: 2 },
    tolerance: 1, // typo tolerance
    limit: limit * 6,
  });
  const out: SearchHit[] = [];
  for (const h of res.hits) {
    const d = h.document as Record<string, string>;
    // Reconstruct just the gate fields `canAccessPage` reads, then apply the request's
    // predicate — gated pages never surface to a reader without the group (SPEC §11.2).
    if (!access({ groups: JSON.parse(d.groups || "[]"), public: d.public === "1" })) continue;
    out.push({
      title: d.title,
      section: d.section,
      heading: d.heading,
      href: d.href,
      snippet: makeSnippet(d.content, term),
    });
    if (out.length >= limit) break;
  }
  return out;
}
