"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { X } from "lucide-react";

/**
 * A prominent announcement bar.
 *
 * Two entry points, same component:
 *  - **Site-wide**, from `docs.json`'s `banner` field, rendered above the navbar on every
 *    page (see the `(docs)` layouts). That's the documented way upstream.
 *  - **In a page**, as `<Banner>` in MDX. Not something upstream documents, but writing it
 *    is a reasonable expectation and this renderer's job is to render what people write
 *    rather than degrade it to bare text.
 *
 * `content` and `children` are interchangeable so both callers are natural: the config path
 * passes a string, MDX passes children.
 *
 * Dismissal is per-render and not persisted. Remembering it needs storage keyed to the
 * banner's identity — otherwise editing the text silently stays dismissed for everyone who
 * closed the previous one — and `docs.json` has no id for it. A banner that comes back on
 * navigation is a smaller problem than one nobody ever sees again.
 */
const TYPES: Record<string, string> = {
  info: "bg-blue-600 text-white",
  warning: "bg-amber-500 text-black",
  critical: "bg-red-600 text-white",
};

export function Banner({
  content,
  type = "info",
  dismissible = false,
  color,
  children,
}: {
  content?: ReactNode;
  type?: string;
  dismissible?: boolean;
  /** `{ light, dark }` overrides. Only `light` is applied — see the note below. */
  color?: { light?: string; dark?: string } | string;
  children?: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  // A custom colour is an inline style, and inline styles can't branch on the theme. The
  // light value wins, since a banner is a deliberately loud element whose author picked a
  // colour to stand out on their brand — better one intentional colour in both themes than
  // a palette default that ignores the author entirely.
  const custom = typeof color === "string" ? color : color?.light;

  return (
    <div
      className={clsx(
        "not-prose relative w-full px-4 py-2 text-center text-sm font-medium",
        !custom && (TYPES[type] ?? TYPES.info),
        custom && "text-white",
      )}
      style={custom ? { backgroundColor: custom } : undefined}
    >
      <span className="[&_a]:underline [&_p]:my-0">{content ?? children}</span>
      {dismissible && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 opacity-80 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
