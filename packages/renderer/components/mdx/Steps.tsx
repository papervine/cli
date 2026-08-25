import type { ReactNode } from "react";

export function Steps({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 ml-3 border-l border-zinc-200 pl-6 dark:border-zinc-800 [counter-reset:step]">
      {children}
    </div>
  );
}

// `title` is a ReactNode rather than a string so the Visual editor can hand in an input and get
// the heading's real styling for free (see StepsNodeView). From MDX it is always a string.
export function Step({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative mb-6 [counter-increment:step] last:mb-0">
      <span className="absolute -left-[2.35rem] flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white before:content-[counter(step)]" />
      {title && <h3 className="m-0 mb-1 text-base font-semibold">{title}</h3>}
      <div className="text-sm text-zinc-700 dark:text-zinc-300 [&>p:first-child]:mt-0">{children}</div>
    </div>
  );
}
