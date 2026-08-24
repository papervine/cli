import type { ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight, File as FileIcon, Folder } from "lucide-react";

/**
 * File/folder tree: `<Tree>` with `<Tree.Folder>` and `<Tree.File>` children. Also exported
 * as `<FileTree>`, the documented alias.
 *
 * **A server component, and it has to be one.** The dotted tags compile to member
 * expressions, so `Tree` must be an object carrying `.Folder` and `.File`. Next replaces the
 * exports of a `"use client"` module with client-reference proxies, and those proxies do not
 * carry arbitrary static properties — so `Tree.File` came back `undefined` and MDX threw
 * "Expected component `Tree.File` to be defined". Anything exposing a member-expression API
 * either stays on the server or has its namespace assembled in a server module (see
 * GitHub.tsx for the latter).
 *
 * Collapsing therefore uses native `<details>`/`<summary>` rather than state: no client
 * bundle, keyboard accessible for free, and it still works with JS disabled.
 */
export function Tree({ children }: { children?: ReactNode }) {
  return (
    <div className="not-prose my-4 overflow-hidden rounded-[var(--db-radius)] border border-zinc-200 bg-zinc-50 px-2 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </div>
  );
}

const ROW = "flex items-center gap-1.5 rounded px-2 py-1";

function TreeFolder({
  name,
  defaultOpen = false,
  openable = true,
  highlight = false,
  children,
}: {
  name: string;
  defaultOpen?: boolean;
  openable?: boolean;
  highlight?: boolean;
  children?: ReactNode;
}) {
  const label = (
    <>
      <ChevronRight
        className={clsx(
          "h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90",
          !openable && "invisible",
        )}
      />
      <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
      <span className="truncate">{name}</span>
    </>
  );
  const tone = highlight ? "font-semibold text-primary" : "text-zinc-700 dark:text-zinc-300";
  const nested = "ml-4 border-l border-zinc-200 pl-2 dark:border-zinc-800";

  // A folder that can't be toggled is not a <details> at all — a disabled disclosure that
  // still looks clickable is worse than plain markup.
  if (!openable) {
    return (
      <div>
        <div className={clsx(ROW, tone)}>{label}</div>
        <div className={nested}>{children}</div>
      </div>
    );
  }

  return (
    <details className="group" open={defaultOpen}>
      <summary
        className={clsx(
          ROW,
          tone,
          "cursor-pointer list-none hover:bg-zinc-100 dark:hover:bg-zinc-800 [&::-webkit-details-marker]:hidden",
        )}
      >
        {label}
      </summary>
      <div className={nested}>{children}</div>
    </details>
  );
}

function TreeFile({ name, highlight = false }: { name: string; highlight?: boolean }) {
  return (
    <div
      className={clsx(
        ROW,
        highlight ? "font-semibold text-primary" : "text-zinc-600 dark:text-zinc-400",
      )}
    >
      {/* Spacer aligning files with the chevron on the folder rows above them. */}
      <span className="h-3.5 w-3.5 shrink-0" />
      <FileIcon className="h-4 w-4 shrink-0 text-zinc-400" />
      <span className="truncate">{name}</span>
    </div>
  );
}

Tree.Folder = TreeFolder;
Tree.File = TreeFile;

export const FileTree = Tree;
