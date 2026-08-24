import type { ReactNode } from "react";

/**
 * A clickable tile: a preview image (children) over an optional title and description.
 * Pairs with `<Columns cols={n}>` for a grid, which is how upstream documents it.
 *
 * `items-start` on the grid and no fixed height here: a percentage height inside a
 * stretched flex/grid item is how the Card component once grew to full page height (see the
 * gotcha log). The preview is constrained by aspect ratio instead.
 */
export function Tile({
  href,
  title,
  description,
  children,
}: {
  href?: string;
  title?: string;
  description?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      {children && (
        <span className="block overflow-hidden rounded-t-[var(--db-radius)] border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 [&_img]:m-0 [&_img]:block [&_img]:w-full">
          {children}
        </span>
      )}
      {(title || description) && (
        <span className="block px-4 py-3">
          {title && (
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </span>
          )}
          {description && (
            <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          )}
        </span>
      )}
    </>
  );

  const shell =
    "card-link not-prose block overflow-hidden rounded-[var(--db-radius)] border border-zinc-200 no-underline transition-colors dark:border-zinc-800";

  return href ? (
    <a href={href} className={`${shell} hover:border-primary`}>
      {body}
    </a>
  ) : (
    <div className={shell}>{body}</div>
  );
}
