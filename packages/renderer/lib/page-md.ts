import "server-only";
import { loadPage } from "@papervine/renderer/lib/content";
import { currentPageAccess } from "./reader-access";

/**
 * One page rendered as clean Markdown — the twin served at `<path>.md`, which is what every
 * link in `/llms.txt` points at (SPEC §9.1).
 *
 * This exists because the alternative is worse for both sides: an agent that follows a link to
 * the HTML page has to strip our chrome to find the prose, and we'd be running a full React
 * render for a client that only wanted the text. The twin costs one file read.
 *
 * The body is the authored MDX with frontmatter replaced by an H1 title and the description
 * (both live in frontmatter, so they'd otherwise be missing). Component tags are left
 * as-authored: an `<Accordion>` in the source is information about the page, and flattening it
 * would be a lossy transform we'd have to keep in sync with the renderer forever.
 *
 * Returns null when the page doesn't exist **or** the current reader can't access it — the
 * same conflation the HTML route makes, so a gated page never confirms it exists (SPEC §11.2).
 * Must run inside the right `contentContext` (and reader access, where there is one).
 */
export async function renderPageMarkdown(slug: string): Promise<string | null> {
  const page = await loadPage(slug);
  if (!page || !currentPageAccess()(page.frontmatter)) return null;
  const fm = page.frontmatter;
  const head = [`# ${fm.title ?? (slug || "Index")}`];
  if (fm.description) head.push("", fm.description);
  return `${head.join("\n")}\n\n${page.body.trim()}\n`;
}

/**
 * The content slug a `.md` request addresses. `/index.md` is how the index page's Markdown is
 * spelled — `/.md` reads as a dotfile and relative-link resolvers mangle it — but the index
 * page's own slug is `""` (the two-spellings gotcha), so it normalizes back here.
 */
export function slugFromMdPath(path: string): string {
  const slug = path.replace(/^\//, "").replace(/\.md$/i, "");
  return slug === "index" ? "" : slug;
}
