import type { ReactNode } from "react";

import { LucideIcon } from "../LucideIcon";

/**
 * A labelled variant of a page's content: `<View title="JavaScript" icon="js">`.
 *
 * **Deliberately not at parity, and the reason matters.** Upstream, sibling `<View>`
 * elements collapse into one dropdown at the top of the page: picking "Python" hides every
 * other view and filters the table of contents to match. That requires processing the page
 * as a whole — the views are *siblings*, not children of a wrapper, so a component can't see
 * its peers. React context doesn't help without a common parent, and having each view hunt
 * for its neighbours in the DOM after mount is the kind of cleverness that breaks on
 * hydration.
 *
 * So each view renders as a labelled section instead, and all of them are visible. That's
 * lossy in layout but not in content: nothing is hidden, everything stays searchable and
 * linkable, and no reader is left unable to reach the variant they came for. Hiding all but
 * one without a working selector would be strictly worse.
 *
 * Proper support belongs with a page-level MDX transform that groups sibling views before
 * render — tracked in GAP-REPORT.
 */
export function View({
  title,
  icon,
  children,
}: {
  title?: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <section className="my-4 rounded-[var(--db-radius)] border border-zinc-200 dark:border-zinc-800">
      {title && (
        <div className="not-prose flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {icon && <LucideIcon name={icon} className="h-3.5 w-3.5 shrink-0" />}
          {title}
        </div>
      )}
      <div className="px-4 py-1">{children}</div>
    </section>
  );
}
