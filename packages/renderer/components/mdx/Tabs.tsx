"use client";

import { Children, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import clsx from "clsx";

type TabProps = { title: string; children: ReactNode };

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children }: { children: ReactNode }) {
  const tabs = Children.toArray(children).filter(
    (c): c is ReactElement<TabProps> => isValidElement(c),
  );
  const [active, setActive] = useState(0);

  return (
    <div className="my-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex gap-1 border-b border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-800 dark:bg-zinc-900">
        {tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={clsx(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              i === active
                ? "border-primary text-primary"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            {tab.props.title}
          </button>
        ))}
      </div>
      <div className="px-4 py-3 text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
        {tabs[active]}
      </div>
    </div>
  );
}
