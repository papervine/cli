import type { ReactNode } from "react";

export function Frame({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <figure className="my-6">
      <div className="overflow-hidden rounded-[var(--db-radius-lg)] border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900 [&>img]:m-0 [&>img]:rounded-[var(--db-radius)]">
        {children}
      </div>
      {caption && (
        <figcaption className="mt-2 text-center text-sm text-zinc-500">{caption}</figcaption>
      )}
    </figure>
  );
}
