"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { LucideIcon } from "./LucideIcon";
import { methodAbbrev, methodTextColor } from "../lib/method-colors";
import type { NavLeaf, NavNode, NavSection } from "../lib/nav";

function isLeaf(n: NavLeaf | NavNode): n is NavLeaf {
  return "href" in n;
}

function containsHref(nodes: (NavLeaf | NavNode)[], pathname: string): boolean {
  return nodes.some((n) => (isLeaf(n) ? n.href === pathname : containsHref(n.items, pathname)));
}

/** A small uppercase badge shown next to a nav entry (frontmatter/group `tag`). */
function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-primary">
      {tag}
    </span>
  );
}

function Leaf({ node }: { node: NavLeaf }) {
  const pathname = usePathname();
  const active = !node.external && pathname === node.href;
  const cls = clsx(
    "flex items-center gap-2 rounded-[var(--db-radius)] px-3 py-1.5 text-sm transition-colors",
    active
      ? "bg-zinc-100 font-medium text-primary dark:bg-white/10"
      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
  );
  const inner = (
    <>
      {node.icon && <LucideIcon name={node.icon} className="h-4 w-4 shrink-0 opacity-70" />}
      <span className="min-w-0 flex-1 truncate">{node.title}</span>
      {node.tag && <TagBadge tag={node.tag} />}
      {node.method && (
        <span
          className={clsx(
            "shrink-0 font-mono text-[0.625rem] font-bold uppercase tracking-wider",
            methodTextColor(node.method),
          )}
        >
          {methodAbbrev(node.method)}
        </span>
      )}
    </>
  );
  // A page with an external `url` opens in a new tab instead of an internal route.
  return node.external ? (
    <a href={node.href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={node.href} className={cls}>
      {inner}
    </Link>
  );
}

/** Top-level group: an icon + bold header (Introduction, Concepts, …). Static by default;
 *  `collapsible` groups (OpenAPI tag groups) add a chevron toggle, starting expanded. */
function TopGroup({ node }: { node: NavNode }) {
  const [open, setOpen] = useState(true);
  const header = (
    <>
      {node.icon && <LucideIcon name={node.icon} className="h-4 w-4 text-zinc-400" />}
      {node.group}
      {node.tag && <TagBadge tag={node.tag} />}
    </>
  );
  if (!node.collapsible) {
    return (
      <>
        <p className="mb-2 flex items-center gap-2 px-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {header}
        </p>
        <NodeList nodes={node.items} depth={1} />
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between px-3 text-sm font-semibold text-zinc-900 transition-colors hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
      >
        <span className="flex items-center gap-2">{header}</span>
        <ChevronRight className={clsx("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-90")} />
      </button>
      {open && <NodeList nodes={node.items} depth={1} />}
    </>
  );
}

/** Nested group: a collapsible row with a chevron (Projects, Preferences, …). */
function SubGroup({ node, depth }: { node: NavNode; depth: number }) {
  const pathname = usePathname();
  // Open by default when it contains the active page, or when `expanded: true`.
  const [open, setOpen] = useState(() => containsHref(node.items, pathname) || !!node.expanded);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-[var(--db-radius)] px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        <span className="flex items-center gap-2">
          {node.group}
          {node.tag && <TagBadge tag={node.tag} />}
        </span>
        <ChevronRight className={clsx("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-90")} />
      </button>
      {open && <NodeList nodes={node.items} depth={depth + 1} />}
    </>
  );
}

function NodeList({ nodes, depth = 0 }: { nodes: (NavLeaf | NavNode)[]; depth?: number }) {
  return (
    <ul
      className={clsx(
        // Wide gaps between top-level groups; comfortable spacing within a group.
        depth === 0 ? "space-y-7" : "space-y-1",
        // The guide rail only appears for nested sub-groups, not the top-level
        // group's items (matches hosted docs platforms).
        depth >= 2 && "ml-[15px] border-l border-zinc-200 pl-3 dark:border-zinc-800",
      )}
    >
      {nodes.map((node, i) => (
        <li key={i}>
          {isLeaf(node) ? (
            <Leaf node={node} />
          ) : depth === 0 ? (
            <TopGroup node={node} />
          ) : (
            <SubGroup node={node} depth={depth} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  // Show only the active tab's nav (hosted docs platforms scopes the sidebar to one tab).
  // The active tab is the one containing the current page; fall back to the first.
  const active = sections.find((s) => s.hrefs.includes(pathname)) ?? sections[0];

  if (!active) return null;

  // `-ml-3` shifts the whole column left by the items' px-3 so their text/icons
  // line up with the logo and tab nav, while the active pill (which extends to
  // this edge) stays inside the box — overflow-y-auto would otherwise clip it.
  return (
    <nav className="sticky top-28 -ml-3 hidden h-[calc(100vh-7rem)] w-64 shrink-0 overflow-y-auto py-8 pr-4 md:block">
      <NodeList nodes={active.nodes} />
    </nav>
  );
}
