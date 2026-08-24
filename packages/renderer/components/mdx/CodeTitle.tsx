import type { ReactNode } from "react";

/**
 * The header bar on a titled code fence (```bash npm) — SPEC §5's "titles" parity target for
 * code blocks, previously unbuilt.
 *
 * `remarkCodeTitles` wraps a titled fence in this component rather than annotating the fence,
 * because the serializer's Shiki integration emits only `class`/`style`/`language` on the
 * `<pre>` and drops `meta` entirely — so a title set on the node never reached the DOM. Handing
 * it to a real component is the same trick `remarkMermaid` and `remarkTreeList` use.
 *
 * `data-code-title` is the contract with `<CodeGroup>`: it reads the label from that attribute
 * for its tab, and hides `[data-code-title-bar]` so the label isn't shown twice.
 */
export function CodeTitle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      data-code-title={title}
      className="my-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
    >
      <div
        data-code-title-bar=""
        className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
      >
        {title}
      </div>
      {/* The fence keeps its own copy button; only its outer chrome is flattened, so the
          title bar and the block read as one element rather than two stacked boxes. */}
      <div className="[&_pre]:my-0 [&_pre]:rounded-none [&_pre]:border-0">{children}</div>
    </div>
  );
}
