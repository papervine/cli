import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * Colour swatches: `<Color variant="compact">` with `<Color.Item>` children, or
 * `variant="table"` with `<Color.Row>` groups.
 *
 * `value` takes any CSS colour, or `{ light, dark }` for a theme-aware pair. The pair is
 * rendered as two stacked swatches toggled by the `dark:` variant rather than read at
 * runtime — a server component can't know which theme the reader has, and doing it in CSS
 * avoids a flash on load.
 */
type ColorValue = string | { light: string; dark: string };

function swatchStyle(value: ColorValue): { light: string; dark?: string } {
  return typeof value === "string" ? { light: value } : { light: value.light, dark: value.dark };
}

export function Color({
  variant = "compact",
  children,
}: {
  variant?: "compact" | "table";
  children?: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "not-prose my-4",
        variant === "compact"
          ? "flex flex-wrap gap-3"
          : "divide-y divide-zinc-200 overflow-hidden rounded-[var(--db-radius)] border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800",
      )}
    >
      {children}
    </div>
  );
}

function ColorItem({ name, value }: { name?: string; value: ColorValue }) {
  const { light, dark } = swatchStyle(value);
  const label = typeof value === "string" ? value : `${value.light} / ${value.dark}`;
  return (
    <div className="flex items-center gap-2">
      <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
        <span className={clsx("absolute inset-0", dark && "dark:hidden")} style={{ background: light }} />
        {dark && <span className="absolute inset-0 hidden dark:block" style={{ background: dark }} />}
      </span>
      <span className="min-w-0">
        {name && (
          <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {name}
          </span>
        )}
        <span className="block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </span>
    </div>
  );
}

function ColorRow({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="p-3">
      {title && (
        <div className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{title}</div>
      )}
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

Color.Item = ColorItem;
Color.Row = ColorRow;
