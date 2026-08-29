import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LucideIcon } from "../LucideIcon";

export function Card({
  title,
  icon,
  href,
  children,
}: {
  // ReactNode, not string: the Visual editor passes a field for the title and a button for the
  // icon, so a card is edited as the card readers see (see CardNodeView). A string still renders
  // exactly as it did.
  title?: ReactNode;
  icon?: ReactNode;
  href?: string;
  children?: ReactNode;
}) {
  const inner = (
    <div
      className={clsx(
        "group h-full rounded-[var(--db-radius-lg)] border border-zinc-200 bg-white p-5 transition-colors dark:border-zinc-800 dark:bg-zinc-900",
        href && "hover:border-primary hover:shadow-sm",
      )}
    >
      {icon &&
        (typeof icon === "string" ? (
          <LucideIcon name={icon} className="mb-3 h-6 w-6 text-primary" />
        ) : (
          // A node fills the slot itself — the icon box is 24px, which is the wrong size for
          // anything but an svg.
          <div className="mb-3">{icon}</div>
        ))}
      {title && <h3 className="m-0 text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>}
      {children && <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 [&>p]:my-0">{children}</div>}
    </div>
  );
  return href ? (
    // `card-link` resets the inherited `.prose a` underline/color (globals.css).
    <Link href={href} className="card-link">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function CardGroup({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return (
    <div
      // One column on phones: the author's column count only applies once there's room for it.
      // A cols={2} grid at 390px leaves each card ~150px, which wraps headings mid-word. The
      // count rides in as a CSS variable because a media query can't live in an inline style,
      // and the breakpoint variant can't interpolate a runtime value.
      className="my-5 grid grid-cols-1 gap-4 sm:grid-cols-[repeat(var(--pv-cols),minmax(0,1fr))]"
      style={{ "--pv-cols": cols } as CSSProperties}
    >
      {children}
    </div>
  );
}
