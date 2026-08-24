import "server-only";
import { runSearch } from "./search";
import { currentPageAccess } from "./reader-access";
import { loadPage, loadConfig } from "@papervine/renderer/lib/content";
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
