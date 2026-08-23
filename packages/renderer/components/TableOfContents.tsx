"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { TocItem } from "../lib/mdx";

/** Highlight the section currently in view as the reader scrolls (scroll-spy). */
function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  // Stable key so the effect only re-binds when the set of ids actually changes,
  // not on every re-render (active-state updates re-render this component).
  const key = ids.join("|");

  useEffect(() => {
    if (ids.length === 0) return;

    const headings = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    // A heading counts as "active" while it sits in the top fifth of the
    // viewport; the bottom margin shrinks the observation band so the next
    // section doesn't activate until it reaches near the top.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -80% 0px", threshold: 0 },
    );

    headings.forEach((h) => observer.observe(h));

    // Seed the initial active heading: the last one already scrolled past.
    const onScroll = () => {
      const passed = headings.filter((h) => h.getBoundingClientRect().top <= 100);
      if (passed.length > 0) setActive(passed[passed.length - 1].id);
    };
    onScroll();

    return () => observer.disconnect();
    // `key` captures the id set; `ids` is intentionally derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}

export function TableOfContents({ items }: { items: TocItem[] }) {
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const active = useActiveHeading(ids);

  if (items.length === 0) return <div className="hidden xl:block xl:w-56 xl:shrink-0" />;
  return (
    // `self-start` keeps the aside at its natural height (flex would otherwise
    // stretch it to the article's height, leaving `sticky` no room to move).
    <aside className="sticky top-28 hidden max-h-[calc(100vh-8rem)] self-start overflow-y-auto xl:block xl:w-56 xl:shrink-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        On this page
      </p>
      <ul className="space-y-1.5 text-sm">
        {items.map((item, i) => {
          const isActive = item.id === active;
          return (
            <li key={i} className={clsx(item.depth === 3 && "ml-3")}>
              <a
                href={`#${item.id}`}
                className={clsx(
                  "transition-colors",
                  isActive
                    ? "font-medium text-primary"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200",
                )}
              >
                {item.text}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
