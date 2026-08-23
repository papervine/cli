"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";

export function Accordion({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-zinc-50 px-4 py-3 text-left text-sm font-medium dark:bg-zinc-900"
      >
        <ChevronRight className={clsx("h-4 w-4 transition-transform", open && "rotate-90")} />
        {title}
      </button>
      {open && (
        <div className="px-4 py-3 text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
          {children}
        </div>
      )}
    </div>
  );
}

export function AccordionGroup({ children }: { children: ReactNode }) {
  return <div className="my-5">{children}</div>;
}
