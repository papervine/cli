/**
 * The pure core of code-block titles: turning a fence's `meta` string into a label.
 *
 * A fence can carry a label after the language — ```bash npm — which docs platforms show as a
 * header on the block and which `<CodeGroup>` uses as its tab label. Both the bare form and an
 * explicit `title="…"` are accepted, since real repos are written both ways.
 *
 * This lives apart from `mdx.tsx` so it can be unit-tested: that module imports `next/cache`
 * and the MDX serializer, which a unit test has no business booting.
 */

/**
 * The label in a fence's `meta`, or `undefined` if there isn't one.
 *
 * ```ts
 * parseCodeTitle("npm")                 // "npm"
 * parseCodeTitle('title="My file.ts"')  // "My file.ts"
 * parseCodeTitle("{1,3-4}")             // undefined — a line-highlight range, not a title
 * ```
 */
export function parseCodeTitle(meta: unknown): string | undefined {
  if (typeof meta !== "string") return undefined;
  const trimmed = meta.trim();
  if (!trimmed) return undefined;

  // Explicit `title="…"` (or single-quoted) wins wherever it appears in the meta, so a fence
  // combining a title with other directives still resolves.
  const explicit = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)')/.exec(trimmed);
  if (explicit) {
    const value = (explicit[1] ?? explicit[2]).trim();
    return value || undefined;
  }

  // Anything containing `=` is some other directive (`showLineNumbers=…`, `lang=…`) and
  // anything starting with `{` is a line-highlight range like {1,3-4} — neither is a title.
  // Bailing here rather than guessing is deliberate: a wrong title is worse than none, because
  // it becomes a CodeGroup tab label that actively misleads.
  if (trimmed.includes("=") || trimmed.startsWith("{")) return undefined;

  // A bare label. Strip surrounding quotes so ```bash "npm install" reads as expected, and
  // collapse internal whitespace so a multi-word label can't wreck the tab bar's layout.
  const bare = trimmed.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  return bare || undefined;
}
