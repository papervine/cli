import type { ReactNode } from "react";

import { Badge } from "./Badge";

/**
 * A changelog entry: `<Update label="2024-10-11" description="v0.1.0" tags={["api"]}>`.
 *
 * The label doubles as an anchor, so a specific release is linkable — that's the behaviour
 * worth preserving, since changelog entries get linked to far more often than they get read
 * top to bottom. The id is slugified the same way headings are, so `#2024-10-11` works.
 *
 * `rss` is accepted and ignored: a feed is a site-level concern (a route that walks the
 * changelog pages), not something a single entry can produce. Accepting it means a docs repo
 * that sets it still renders rather than tripping the unknown-prop path.
 */
export function Update({
  label,
  description,
  tags,
  children,
}: {
  label: string;
  description?: string;
  tags?: string[];
  /** Per-entry RSS metadata. Accepted for compatibility; feeds are site-level. */
  rss?: unknown;
  children?: ReactNode;
}) {
  const id = label
    ?.toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  return (
    <div
      id={id}
      // The divider trails each entry rather than leading it. A leading `border-t` with
      // `first:border-t-0` looks right and is dead code: in MDX the first `<Update>` is a
      // sibling of the preceding `<h2>`, never its parent's first child, so `:first-child`
      // can't match — every entry drew a top rule, leaving a stray line and an empty band
      // under the heading. `first:`/`last:` are unreliable for any MDX component for the
      // same reason.
      className="mb-8 grid gap-4 border-b border-zinc-200 pb-8 dark:border-zinc-800 md:grid-cols-[10rem_1fr] md:items-start"
    >
      <div className="not-prose md:sticky md:top-24">
        <a
          href={`#${id}`}
          className="card-link text-sm font-semibold text-zinc-900 hover:text-primary dark:text-zinc-100"
        >
          {label}
        </a>
        {description && (
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</div>
        )}
        {tags && tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge key={tag} size="xs" shape="pill">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
