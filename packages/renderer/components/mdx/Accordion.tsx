"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";

/**
 * A collapsible section. One definition, used by readers and by the Visual editor — which is why
 * three of these props exist:
 *
 * - `title` is a **ReactNode**, so the editor can hand in a real field (and its row controls)
 *   instead of text. `<Step>` takes its title the same way and for the same reason.
 * - `open` / `onToggle` make it controllable. Open-and-closed in the editor is *view* state — it
 *   never touches `defaultOpen`, which is what a reader gets on load.
 * - `keepMounted` hides the body instead of unmounting it. The editor's body IS ProseMirror's
 *   content hole: taking it out of the DOM takes the node's content with it, which is why every
 *   accordion in the editor used to be pinned open.
 *
 * Readers pass none of them and get exactly what they got before.
 */
export function Accordion({
  title,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  keepMounted = false,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const toggle = () => (onToggle ? onToggle() : setUncontrolledOpen((o) => !o));
  // A text title goes INSIDE the button, so the whole row is one click target. Anything else is
  // interactive in its own right (the editor's title field), and nesting that in a button would
  // make it unusable — so the button shrinks to the chevron and the node sits beside it.
  const textTitle = typeof title === "string" || typeof title === "number";

  return (
    // pv-accordion is the hook AccordionGroup flattens against — see there.
    <div className="pv-accordion my-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex w-full items-center gap-2 bg-zinc-50 px-4 py-3 text-left text-sm font-medium dark:bg-zinc-900">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={clsx(
            "flex items-center gap-2 text-left",
            textTitle ? "min-w-0 flex-1" : "shrink-0",
          )}
        >
          <ChevronRight className={clsx("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} />
          {textTitle && title}
        </button>
        {!textTitle && title}
      </div>
      {(open || keepMounted) && (
        <div
          hidden={!open}
          className="px-4 py-3 text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A run of accordions, drawn as ONE list: a single border with hairlines between the rows, rather
 * than a stack of separate boxes. The rows keep drawing their own box for when they stand alone,
 * so the group's job is to flatten them — by descendant selector, not `>`, because in the editor
 * ProseMirror's children arrive wrapped in elements of TipTap's own. `divide-y` is the exception
 * and stays direct-child: whatever the wrapper is, it's what needs the line between it and the next.
 */
export function AccordionGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className={clsx(
        "pv-accordion-group my-5 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200",
        "dark:divide-zinc-800 dark:border-zinc-800",
        "[&_.pv-accordion]:my-0 [&_.pv-accordion]:rounded-none [&_.pv-accordion]:border-0",
      )}
    >
      {children}
    </div>
  );
}
