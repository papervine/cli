import "server-only";
import { createHighlighter, type Highlighter } from "shiki";

/**
 * Standalone Shiki highlighter for code we generate at render time (the API reference's
 * request/response samples in the sticky right column) — as opposed to fenced code in MDX,
 * which the serializer highlights at compile time (see `mdx.tsx`). The right
 * column is always dark, so a single
 * `github-dark` theme matches the dark-mode tokens readers see in MDX code blocks.
 *
 * The highlighter is a module-level singleton (creating one loads WASM + grammars, ~tens of
 * ms) shared across requests; `highlightToHtml` is the only export callers need.
 */
const LANGS = ["bash", "json", "javascript", "python"] as const;
export type HighlightLang = (typeof LANGS)[number];

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: ["github-dark"], langs: [...LANGS] });
  return highlighterPromise;
}

/**
 * Highlight `code` as `lang` into a `<pre class="shiki">…</pre>` string. The panel supplies its
 * own background, so we strip Shiki's inline `background-color` and let token colors show on the
 * dark panel. Falls back to an escaped plain `<pre>` if the grammar is missing — never throws,
 * because a code sample must never 500 an endpoint page (the renderer's core principle).
 */
export async function highlightToHtml(code: string, lang: HighlightLang): Promise<string> {
  try {
    const hl = await getHighlighter();
    return hl.codeToHtml(code, {
      lang,
      theme: "github-dark",
      colorReplacements: { "#24292e": "transparent" }, // github-dark bg → panel provides it
    });
  } catch {
    const escaped = code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    return `<pre class="shiki"><code>${escaped}</code></pre>`;
  }
}
