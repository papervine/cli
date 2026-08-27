import type { PageEntry } from "./docs-tools";

/**
 * The pure assembly half of the AI-discovery feed (SPEC §9.1): given already-loaded data,
 * produce the llms.txt text. Kept free of content-source reads so the format — which is the
 * part with actual rules (heading nesting, `.md` rewriting, truncation, section order) — is
 * unit-testable without a repo, a DB, or a server. `llms.ts` does the loading and calls in
 * here.
 */

/** Where a page's clean-Markdown twin is served — the `.md` route (`page-md-route.ts`). */
export function mdHref(href: string): string {
  // The index page is served at `/`, and `/.md` is not a path anyone would guess or that a
  // relative-link resolver handles sanely; its Markdown lives at `/index.md`, which the `.md`
  // handler normalizes back to the index slug.
  return href === "/" ? "/index.md" : `${href}.md`;
}

/** A description is a teaser, not the page — a long one would drown the index. */
export const MAX_DESCRIPTION = 300;

export function truncate(text: string, max = MAX_DESCRIPTION): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Every OpenAPI/AsyncAPI spec the navigation points at, in document order. `docs.json`
 * attaches a spec by putting an `openapi`/`asyncapi` key on a nav division — at any depth,
 * and in several shapes (a bare string, an array of sources, `{ source }`) — so this scans
 * the tree generically rather than enumerating the division types, for the same reason
 * `buildNav` walks it generically.
 */
export function specPaths(navigation: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "openapi" || key === "asyncapi") {
        for (const spec of Array.isArray(value) ? value : [value]) {
          const path =
            typeof spec === "string"
              ? spec
              : spec && typeof spec === "object" && typeof (spec as { source?: unknown }).source === "string"
                ? (spec as { source: string }).source
                : null;
          // Only *our own* files get listed: an externally hosted spec is already reachable
          // at its own URL and isn't ours to advertise as part of this site.
          if (path && !/^https?:\/\//i.test(path) && !out.includes(path)) out.push(path);
        }
        continue;
      }
      visit(value);
    }
  };
  visit(navigation);
  return out;
}

/** Emit the `##`/`###`/`####` headings needed to move from one group trail to the next. */
export function headingsFor(trail: string[], previous: string[]): string[] {
  const firstChange = trail.findIndex((g, i) => previous[i] !== g);
  const from = firstChange === -1 ? Math.min(trail.length, previous.length) : firstChange;
  const lines: string[] = [];
  for (let depth = from; depth < trail.length; depth++) {
    // Cap at h4: llms.txt is a flat-ish index, and a deeply nested docs tree would otherwise
    // produce headings no client renders meaningfully.
    lines.push("", `${"#".repeat(Math.min(depth + 2, 4))} ${trail[depth]}`, "");
  }
  return lines;
}

export function linkLine(origin: string, entry: PageEntry): string {
  // External leaves keep their absolute URL and have no Markdown twin to point at.
  const href = entry.external ? entry.href : `${origin}${mdHref(entry.href)}`;
  const suffix = entry.description ? `: ${truncate(entry.description)}` : "";
  return `- [${entry.title}](${href})${suffix}`;
}

export type LlmsIndexInput = {
  origin: string;
  name: string;
  description?: string;
  /** `markdown.instructions` — owner-authored guidance for AI clients, emitted verbatim. */
  instructions?: string;
  entries: PageEntry[];
  /** `seo.indexing: "all"` extras: pages that exist but aren't in the navigation. */
  unlisted?: PageEntry[];
  /** Docs-root-relative OpenAPI/AsyncAPI spec paths. */
  specs?: string[];
};

/**
 * The llmstxt.org shape: an H1 with the site name, a blockquote summary, then the pages as a
 * linked list under headings mirroring the sidebar's tabs and groups. Every internal link
 * points at the page's `.md` twin rather than its HTML, so a client that follows one gets
 * clean Markdown instead of a page it has to strip.
 */
export function formatLlmsIndex(input: LlmsIndexInput): string {
  const { origin, entries } = input;
  const lines: string[] = [`# ${input.name}`];
  if (input.description) lines.push("", `> ${truncate(input.description, 500)}`);
  if (input.instructions?.trim()) lines.push("", input.instructions.trim());

  // External links are collected out of nav order into a trailing "Optional" section, per the
  // llmstxt.org convention that it holds what a client may skip when short on context.
  const internal = entries.filter((e) => !e.external);
  const external = entries.filter((e) => e.external);

  let trail: string[] = [];
  let heading = false;
  for (const entry of internal) {
    if (entry.groups.length) {
      lines.push(...headingsFor(entry.groups, trail));
      trail = entry.groups;
      heading = true;
    } else if (!heading) {
      // Top-level pages sit under no group; give them a heading so the list is never orphaned
      // (and so a site with no groups at all still has one section).
      lines.push("", "## Docs", "");
      trail = [];
      heading = true;
    } else {
      trail = [];
    }
    lines.push(linkLine(origin, entry));
  }
  if (!internal.length) lines.push("", "## Docs", "");

  if (input.unlisted?.length) {
    lines.push("", "## Additional pages", "");
    for (const entry of input.unlisted) lines.push(linkLine(origin, entry));
  }

  if (input.specs?.length) {
    lines.push("", "## API specifications", "");
    for (const spec of input.specs) {
      lines.push(`- [${spec.split("/").pop() ?? spec}](${origin}/${spec.replace(/^\//, "")})`);
    }
  }

  if (external.length) {
    lines.push("", "## Optional", "");
    for (const entry of external) lines.push(linkLine(origin, entry));
  }

  return joinBlock(lines);
}

/**
 * Join the assembled lines, collapsing runs of blank lines to one. Each emitter pads itself
 * with a blank line so it reads correctly in isolation, which means a nested heading (`##`
 * immediately followed by `###`) otherwise lands a double blank in the middle of the file.
 * Normalizing once here beats making every emitter aware of what came before it.
 */
function joinBlock(lines: string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && out[out.length - 1] === "") continue;
    out.push(line);
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

/** One page's section in llms-full.txt: a rule, the title, where it came from, the body. */
export function formatLlmsFullPage(
  origin: string,
  entry: PageEntry,
  body: string,
): string[] {
  const lines = ["", "---", "", `# ${entry.title}`, `Source: ${origin}${mdHref(entry.href)}`];
  if (entry.description) lines.push(`Description: ${truncate(entry.description)}`);
  lines.push("", body.trim());
  return lines;
}
