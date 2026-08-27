import "server-only";
import { loadConfig, loadPage, loadRaw } from "@papervine/renderer/lib/content";
import {
  listPageEntries,
  listUnlistedPageSlugs,
  type PageEntry,
} from "@papervine/renderer/lib/docs-tools";
import { formatLlmsFullPage, formatLlmsIndex, specPaths } from "./llms-format";

export { mdHref } from "./llms-format";

/**
 * Render `/llms.txt` (or `/llms-full.txt`) for the docs site in scope (SPEC §9.1, §10.1).
 *
 * This half does the loading; `llms-format.ts` does the (unit-tested) assembly. `full`
 * additionally inlines every page body — llms-full.txt, for clients that want the whole
 * corpus in one fetch rather than crawling the index.
 *
 * A repo can override either file wholesale by committing its own `llms.txt` /
 * `llms-full.txt` at the docs root — an escape hatch for owners who'd rather hand-curate
 * what agents read, checked before we generate anything.
 *
 * Must run inside the tenant's `contentContext` (the caller sets it) so every read resolves
 * against the right source.
 */
export async function renderLlmsTxt(origin: string, full: boolean): Promise<string> {
  const custom = await loadRaw(full ? "llms-full.txt" : "llms.txt");
  if (custom?.trim()) return custom.endsWith("\n") ? custom : custom + "\n";

  const config = await loadConfig();
  const entries = await listPageEntries();

  const index = formatLlmsIndex({
    origin,
    name: config.name,
    ...(config.description ? { description: config.description } : {}),
    ...(config.markdown?.instructions ? { instructions: config.markdown.instructions } : {}),
    entries,
    // `seo.indexing: "all"` publishes pages that exist but aren't in the navigation; the
    // default ("navigable") lists only what a reader could reach from the sidebar.
    unlisted: config.seo?.indexing === "all" ? await unlistedEntries() : [],
    specs: specPaths(config.navigation),
  });
  if (!full) return index;

  const lines = [index.trimEnd()];
  for (const entry of entries) {
    if (entry.external) continue; // nothing of ours to inline
    const page = await loadPage(entry.href === "/" ? "" : entry.href.replace(/^\//, ""));
    if (!page) continue;
    lines.push(...formatLlmsFullPage(origin, entry, page.body));
  }
  return lines.join("\n") + "\n";
}

/** Non-navigable pages as index entries, for `seo.indexing: "all"`. */
async function unlistedEntries(): Promise<PageEntry[]> {
  const slugs = await listUnlistedPageSlugs();
  const out: PageEntry[] = [];
  for (const slug of slugs) {
    const page = await loadPage(slug);
    const description = page?.frontmatter.description;
    out.push({
      title: page?.frontmatter.title ?? (slug || "Index"),
      href: slug === "" ? "/" : `/${slug}`,
      groups: [],
      ...(description ? { description } : {}),
    });
  }
  return out;
}
