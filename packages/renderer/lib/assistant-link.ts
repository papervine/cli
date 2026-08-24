/**
 * Resolve where an assistant answer's link should go when clicked. Pure so it can be unit-
 * tested without a DOM (the component passes `window.location.origin` for `origin`).
 *
 * A citation to a docs page must **soft-navigate** within the docs SPA (no full reload, no new
 * tab). This returns the in-app navigation target for such a link, or `null` when the link is a
 * same-page anchor (let the browser scroll) or genuinely external (open in a new tab).
 *
 * `base` handles the two serving modes: empty on a subdomain/custom domain (root-absolute links
 * already resolve), or `/sites/{slug}` in apex path mode, where a `/quickstart` citation must be
 * prefixed to land on the tenant's page rather than the apex.
 */
export function assistantInternalTarget(
  href: string | undefined,
  base: string,
  origin: string,
): string | null {
  if (!href || href.startsWith("#")) return null; // missing, or a same-page anchor
  if (href.startsWith("/")) return base + href; // root-absolute docs link
  try {
    const u = new URL(href, origin);
    if (u.origin === origin) return u.pathname + u.search + u.hash; // absolute, same origin
  } catch {
    // not a parseable URL (e.g. "mailto:", a bare word) → treat as external/non-nav
  }
  return null;
}
