/**
 * The "Try it" playground's open state, carried in the URL.
 *
 * Navigating between endpoint pages remounts the playground — same route file, but the App Router
 * rebuilds the subtree — so its open state can't ride along in component state. That's why the
 * in-modal operation switcher used to dump you on the next endpoint with the playground shut,
 * which is the one thing that control exists to avoid. Its links carry this flag instead, and a
 * fresh mount reads it back.
 *
 * A query parameter rather than a hash: docs pages already use the hash for heading anchors, so a
 * page with a `## Playground` heading would collide. The side benefit is a shareable link that
 * opens an endpoint ready to run.
 *
 * Pure (the current URL is passed in) so it unit-tests without a browser.
 */

const PLAYGROUND_PARAM = "playground";

/** Link to an operation with the playground open — what the operation switcher points at. */
export function playgroundHref(slug: string): string {
  return `/${slug}?${PLAYGROUND_PARAM}=open`;
}

/** Whether a location's query string asks for the playground. */
export function playgroundRequested(search: string): boolean {
  return new URLSearchParams(search).has(PLAYGROUND_PARAM);
}

/**
 * The current URL with the flag added or removed, so it keeps describing what's on screen. Other
 * query parameters are left alone — the docs site may be carrying its own.
 */
export function playgroundUrl(href: string, open: boolean): string {
  const url = new URL(href);
  if (open) url.searchParams.set(PLAYGROUND_PARAM, "open");
  else url.searchParams.delete(PLAYGROUND_PARAM);
  return url.toString();
}
