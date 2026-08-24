import type { ReactNode } from "react";

/**
 * Sidebar content: `<Panel>`, plus `<RequestExample>` / `<ResponseExample>`.
 *
 * Upstream these *move* content into the right-hand column, replacing the table of contents.
 * Doing that here would mean the page component reaching into compiled MDX to pull matching
 * elements out of the flow before render — the layout is decided by `(docs)/[[...slug]]`,
 * which has already committed to article-plus-TOC by the time MDX runs.
 *
 * So they render inline, styled as the distinct panels they are, and stay in document order.
 * The trade is deliberate: for a request/response pair the practical loss is that examples
 * sit under the prose instead of beside it, while the content, its code highlighting and its
 * copy buttons are all intact. Relocating them is a layout change tracked in GAP-REPORT, not
 * something to fake by hiding and re-rendering.
 */
function Shell({ label, children }: { label?: string; children?: ReactNode }) {
  return (
    <aside className="my-4 overflow-hidden rounded-[var(--db-radius)] border border-zinc-200 dark:border-zinc-800">
      {label && (
        <div className="not-prose border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {label}
        </div>
      )}
      <div className="px-4 py-1 [&>pre]:my-3">{children}</div>
    </aside>
  );
}

export function Panel({ children }: { children?: ReactNode }) {
  return <Shell>{children}</Shell>;
}

export function RequestExample({ children }: { dropdown?: boolean; children?: ReactNode }) {
  return <Shell label="Request">{children}</Shell>;
}

export function ResponseExample({ children }: { dropdown?: boolean; children?: ReactNode }) {
  return <Shell label="Response">{children}</Shell>;
}
