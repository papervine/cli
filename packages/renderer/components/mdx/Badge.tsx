import type { ReactNode } from "react";
import clsx from "clsx";

import { LucideIcon } from "../LucideIcon";

/**
 * Inline status label. `<Badge color="green" size="md">Beta</Badge>`
 *
 * Colours are mapped to a fixed palette rather than passed through as arbitrary CSS, so a
 * badge always has readable contrast in both themes — an author-supplied hex can't be
 * checked against the current background. An unknown colour falls back to gray.
 */
const COLORS: Record<string, string> = {
  gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  white: "bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
  surface: "bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  "white-destructive": "bg-white text-red-600 dark:bg-zinc-900 dark:text-red-400",
  "surface-destructive": "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
};

const SIZES: Record<string, string> = {
  xs: "px-1.5 py-0 text-[10px] gap-1",
  sm: "px-2 py-0.5 text-xs gap-1",
  md: "px-2.5 py-0.5 text-xs gap-1.5",
  lg: "px-3 py-1 text-sm gap-1.5",
};

const STROKE: Record<string, string> = {
  gray: "border-zinc-300 dark:border-zinc-700",
  blue: "border-blue-300 dark:border-blue-800",
  green: "border-green-300 dark:border-green-800",
  yellow: "border-yellow-300 dark:border-yellow-800",
  orange: "border-orange-300 dark:border-orange-800",
  red: "border-red-300 dark:border-red-800",
  purple: "border-purple-300 dark:border-purple-800",
  white: "border-zinc-300 dark:border-zinc-700",
  surface: "border-zinc-300 dark:border-zinc-700",
  "white-destructive": "border-red-300 dark:border-red-800",
  "surface-destructive": "border-red-300 dark:border-red-800",
};

export function Badge({
  color = "gray",
  size = "md",
  shape = "rounded",
  icon,
  stroke = false,
  disabled = false,
  className,
  children,
}: {
  color?: string;
  size?: string;
  shape?: "rounded" | "pill";
  icon?: string;
  stroke?: boolean;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const key = COLORS[color] ? color : "gray";
  return (
    <span
      className={clsx(
        "inline-flex items-center align-middle font-medium",
        COLORS[key],
        SIZES[size] ?? SIZES.md,
        shape === "pill" ? "rounded-full" : "rounded",
        stroke && clsx("border", STROKE[key]),
        disabled && "opacity-50",
        className,
      )}
    >
      {icon && <LucideIcon name={icon} className="h-3 w-3 shrink-0" />}
      {children}
    </span>
  );
}
