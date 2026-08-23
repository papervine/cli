/**
 * Tenant URL base-prefixing — the one rule that makes path-based tenant serving work.
 *
 * Docs normally render at the tenant's own host (`acme.papervine.io/foo`), where every
 * internal link and asset is root-absolute (`/foo`, `/img/x.png`) and Just Works.
 * When there's no custom/subdomain available (e.g. a bare Vercel `*.vercel.app`
 * deploy, where nested-subdomain TLS isn't issued), we instead serve the same docs
 * under a path on the platform apex (`apex/sites/acme/foo`). There, those root-absolute
 * URLs would escape the tenant — so we prefix them with the tenant's base.
 *
 * `base` is empty in host mode (subdomain) → these are no-ops and output is identical.
 */

/**
 * Prefix a root-absolute *internal* URL with `base`. Leaves external (`https://`),
 * protocol-relative (`//cdn`), anchor (`#x`), query (`?x`) and relative (`x/y`) URLs
 * untouched — only same-origin paths rooted at `/` are tenant-scoped.
 */
export function withBase(url: string | undefined, base: string): string | undefined {
  if (!url || !base) return url;
  if (url[0] !== "/" || url[1] === "/") return url; // external / protocol-relative / anchor / relative
  return base + url;
}
