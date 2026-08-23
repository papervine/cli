"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { NavSection } from "../lib/nav";

/**
 * Horizontal tab bar (hosted docs platforms' top-level `navigation.tabs`). Each tab links to
 * its first page; the active tab is the one containing the current page. Renders
 * nothing when there's only one (unnamed) section.
 */
export function NavTabs({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  const tabs = sections.filter((s) => s.tab);
  if (tabs.length < 2) return null;

  const active = sections.find((s) => s.hrefs.includes(pathname)) ?? sections[0];

  return (
    <nav className="sticky top-16 z-30 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-7xl gap-6 pl-9 pr-6">
        {tabs.map((t) => {
          const isActive = t === active;
          return (
            <Link
              key={t.tab}
              href={t.href ?? "/"}
              className={clsx(
                "-mb-px border-b-2 py-3 text-sm transition-colors",
                isActive
                  ? "border-primary font-medium text-zinc-900 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              {t.tab}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
