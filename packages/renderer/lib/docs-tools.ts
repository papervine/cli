import "server-only";
import { runSearch } from "./search";
import { currentPageAccess } from "./reader-access";
import { loadPage, loadConfig, listPageSlugs } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";
import { loadApiCatalog } from "@papervine/renderer/lib/openapi";
import type { DocsConfig } from "@papervine/renderer/lib/config";

/**
 * Docs retrieval capabilities — the single implementation behind two transports
 * (SPEC §8.5): the in-app AI assistant wraps these as Vercel AI SDK tools
 * (`assistant-tools.ts`), and the generated MCP server exposes them to external
 * clients (`src/app/api/[transport]/route.ts`). Keep the behavior here so both
 * stay in lockstep.
 */

export async function searchDocs(query: string) {
  // Gate retrieval by the reader's access. This used to be supplied by the web app's thin
  // `runSearch` wrapper; now that these tools are shared with the CLI it is applied here, at the
  // one place that actually retrieves. The predicate defaults to allow-all, so the CLI (which
  // has no readers) is unaffected while a gated hosted site still cannot leak through RAG.
  const hits = await runSearch(query, { access: currentPageAccess() });
  return hits.slice(0, 8).map((h) => ({
    title: h.title,
    heading: h.heading,
    href: h.href,
    snippet: h.snippet,
  }));
}

export async function readPage(slug: string) {
  const clean = slug.replace(/^\//, "");
  const page = await loadPage(clean);
  // A page the reader can't access reads as "not found" — same response as a missing page,
  // so retrieval (RAG/MCP/search) never confirms a gated page even exists (SPEC §11.2).
  if (!page || !currentPageAccess()(page.frontmatter)) {
    return { error: `No page found for slug "${slug}".` };
  }
  return {
    title: page.frontmatter.title,
    description: page.frontmatter.description,
    href: "/" + clean,
    body: page.body.slice(0, 8000),
  };
}

export async function listPages() {
  // Pass the reader's access predicate so gated pages are dropped from the listing the same
  // way they're dropped from the sidebar (buildNav already honors it) — SPEC §11.2.
  const sections = await buildNav(await loadConfig(), "", currentPageAccess());
  const out: { title: string; href: string }[] = [];
  const walk = (nodes: (NavLeaf | NavNode)[]) => {
    for (const n of nodes) {
      if ("href" in n) out.push({ title: n.title, href: n.href });
      else walk(n.items);
    }
  };
  for (const s of sections) walk(s.nodes);
  return out;
}

/**
 * One entry in the AI-discovery index: a nav leaf, plus the group trail above it and its
 * frontmatter description. `listPages` is the flat title+href listing the MCP tools want;
 * this is the structured variant `/llms.txt` needs to mirror the sidebar's sections and
 * annotate every link (SPEC §9.1).
 *
 * Two filters apply, both deliberately the ones the human-facing surfaces already use:
 * reader access (via `buildNav`, SPEC §11.2) and page-level `noindex: true` — the opt-out
 * that excludes a page from search and from SEO also excludes it from the feed AI clients
 * read.
 */
export type PageEntry = {
  title: string;
  href: string;
  description?: string;
  /** Tab + group labels above this leaf, outermost first. Empty for a top-level page. */
  groups: string[];
  /** Frontmatter `url` — an absolute link off-site, not one of our pages. */
  external?: boolean;
};

/** Nav-ordered page entries with their group trail and description. */
export async function listPageEntries(): Promise<PageEntry[]> {
  const sections = await buildNav(await loadConfig(), "", currentPageAccess());
  const out: PageEntry[] = [];

  const walk = async (nodes: (NavLeaf | NavNode)[], trail: string[]) => {
    for (const n of nodes) {
      if (!("href" in n)) {
        await walk(n.items, [...trail, n.group]);
        continue;
      }
      if (n.external) {
        out.push({ title: n.title, href: n.href, groups: trail, external: true });
        continue;
      }
      // buildNav already loaded this page to resolve the leaf's title/icon, and loadPage is
      // request-cached, so this is a cache hit for every page but the index — whose slug has
      // two spellings ("index" in docs.json, "" for the `/` route), so it re-reads once.
      const page = await loadPage(slugForHref(n.href));
      if (page?.frontmatter.noindex) continue;
      const description = page?.frontmatter.description;
      out.push({
        title: n.title,
        href: n.href,
        groups: trail,
        ...(description ? { description } : {}),
      });
    }
  };

  // A tab is the outermost division, so it names the outermost section.
  for (const s of sections) await walk(s.nodes, s.tab ? [s.tab] : []);
  return out;
}

/**
 * Slugs of pages that exist in the content but appear nowhere in the navigation — what
 * `seo.indexing: "all"` asks us to publish anyway. Access-gated and `noindex`-filtered like
 * everything else, and sorted so the feed doesn't churn between requests.
 */
export async function listUnlistedPageSlugs(): Promise<string[]> {
  const navigable = new Set((await listPageEntries()).map((e) => slugForHref(e.href)));
  const slugs = await listPageSlugs();
  const out: string[] = [];
  for (const slug of [...slugs].sort()) {
    // Normalize before comparing: listPageSlugs spells the index page "index" or "" depending
    // on the source, while its nav href is always "/" (the two-spellings gotcha).
    const canonical = slug === "index" ? "" : slug;
    if (navigable.has(canonical)) continue;
    const page = await loadPage(canonical);
    if (!page || page.frontmatter.noindex) continue;
    if (!currentPageAccess()(page.frontmatter)) continue;
    out.push(canonical);
  }
  return out;
}

/** The content slug a nav href addresses — the inverse of nav.ts's `routeForSlug`. */
function slugForHref(href: string): string {
  return href === "/" ? "" : href.replace(/^\//, "");
}

export async function searchApi(query: string) {
  const catalog = await loadApiCatalog(await loadConfig());
  const q = query.toLowerCase();
  return [...catalog.values()]
    .filter((op) =>
      `${op.method} ${op.path} ${op.summary ?? ""} ${op.description ?? ""}`.toLowerCase().includes(q),
    )
    .slice(0, 10)
    .map((op) => ({ method: op.method, path: op.path, summary: op.summary, href: "/" + op.slug }));
}

/** Whether this docs site has any OpenAPI-backed API reference (gates the API tools). */
export async function apiEnabled(config?: DocsConfig): Promise<boolean> {
  const catalog = await loadApiCatalog(config ?? (await loadConfig()));
  return catalog.size > 0;
}
