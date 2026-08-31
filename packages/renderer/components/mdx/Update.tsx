import { Children, isValidElement, type ReactNode } from "react";

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
  // The entry's title is the author's own first heading, so the description has to be placed
  // relative to it rather than emitted in a fixed slot — see the content column below.
  const kids = Children.toArray(children);
  const startsWithHeading =
    isValidElement(kids[0]) && typeof kids[0].type === "string" && /^h[1-6]$/.test(kids[0].type);
  const descriptionLine = description ? (
    <p className="mt-2 text-zinc-500 dark:text-zinc-400">{description}</p>
  ) : null;

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
      // `items-baseline` is what puts the label chip on the TITLE's line rather than at the top of
      // the column — the two read as one row, which is how a changelog is scanned. The title itself
      // is the author's heading, so the arbitrary variants below tune it for this context: a step up
      // in size, no top margin (prose gives an h2 `mt-10`, which is what dropped it below the chip),
      // and no bottom rule (the entry already ends in one — two rules per entry read as a table).
      className="mb-8 grid gap-4 border-b border-zinc-200 pb-8 dark:border-zinc-800 md:grid-cols-[10rem_1fr] md:items-baseline [&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-2xl [&_h3]:text-xl"
    >
      <div className="not-prose md:sticky md:top-24">
        {/* The label is a CHIP, not a line of text: a changelog is scanned down its left edge, and a
            filled pill gives the eye a rail to run along that plain bold text doesn't. It stays a
            real anchor — the chip is what you copy the link from. Emerald rather than the theme's
            primary: a release marker reading as "new" is the convention here, and it keeps its
            meaning on a site whose primary colour is doing other work. */}
        <a
          href={`#${id}`}
          // `card-link` resets the inherited `.prose a` underline; the colour needs `!` on top of
          // it, because `.prose a.card-link` sets `text-inherit` and a two-class selector outranks
          // a utility. Same shape as Prompt's chip link, for the same reason.
          className="card-link inline-block rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-medium !text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-500/10 dark:!text-emerald-400 dark:hover:bg-emerald-500/20"
        >
          {label}
        </a>
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
      {/* The entry's own content, and the description with it — NOT over in the label column, where
          it sat a whole column away from the words it describes. It reads as the title's subtitle,
          so it goes directly under the title when the entry opens with one, and leads the entry
          when it doesn't. Splitting the children is the only way to land between the two: the title
          is the author's own heading, not a prop.

          `startsWithHeading` degrades safely — if headings are ever mapped to a component, the test
          stops matching and the description leads the entry instead of following the title. Wrong
          order, never a lost description. */}
      <div className="min-w-0 [&>:first-child]:mt-0">
        {startsWithHeading ? (
          <>
            {kids[0]}
            {descriptionLine}
            {kids.slice(1)}
          </>
        ) : (
          <>
            {descriptionLine}
            {children}
          </>
        )}
      </div>
    </div>
  );
}
