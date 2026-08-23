"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";

/** hosted docs platforms' <Expandable title="…"> — inline collapsible for nested schema fields. */
export function Expandable({
  title,
  defaultOpen = false,
  children,
}: {
  title?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="my-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <ChevronRight className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        {open ? "Hide" : "Show"} {title ?? "child attributes"}
      </button>
      {open && (
        <div className="mt-1 border-l border-zinc-200 pl-4 dark:border-zinc-800">{children}</div>
      )}
    </div>
  );
}
