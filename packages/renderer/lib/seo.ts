import type { Metadata } from "next";
import type { DocsConfig } from "./config";
import type { PageFrontmatter } from "./content";
import { withBase } from "./url-base";

/**
 * Social/SEO metadata for a docs page — SPEC.md §4 (`docs.json` `seo`) and §5.
 *
 * This is a PURE module (no I/O, no `next/headers`) so every route that renders docs can
 * share one implementation: the hosted app's three host modes (tenant subdomain, apex
 * `/sites/{slug}` path mode, custom domain) and the published CLI's single-repo server.
 * Each of those has its own `generateMetadata`, and before this they each emitted a
 * different (mostly empty) subset — a tenant page's `<title>` was the *site* name on every
 * page, and nothing anywhere emitted an `og:`/`twitter:` tag, so a shared docs link
 * unfurled as a bare URL.
 *
 * Precedence, most specific first:
 *   1. the page's own frontmatter meta tags (`og:image:`, `twitter:card:`, …)
 *   2. `docs.json` → `seo.metatags` (site-wide)
 *   3. what we derive from the page (title, description) + the auto-generated card
 *
 * That ordering is the docs.json-compatible one, so a migrated repo that already sets
 * either keeps the images it was publishing.
 */

/** Every generated card is a 1.91:1 large-summary image — the size X and Facebook expect. */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Meta tags as authored: tag name → content. */
export type Metatags = Record<string, string>;

/**
 * Tag names we translate into Next's *typed* metadata fields below. They're stripped from the
 * verbatim passthrough so a tag set in `docs.json`/frontmatter is emitted once, not twice
 * (Next renders `other` as a plain `<meta name>`, which would sit alongside the `property`
 * form it emits for the same tag).
 */
const TYPED_TAGS = new Set([
  "title",
  "description",
  "keywords",
  "og:type",
  "og:title",
  "og:description",
  "og:url",
  "og:site_name",
  "og:image",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:site",
  "twitter:creator",
]);

function coerceTags(raw: unknown): Metatags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Metatags = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/** Site-wide meta tags from `docs.json` → `seo.metatags`. Absent/malformed → none. */
export function configMetatags(config: DocsConfig): Metatags {
  return coerceTags((config as { seo?: { metatags?: unknown } }).seo?.metatags);
}

/**
 * Per-page meta tags from frontmatter. A frontmatter key is treated as a meta tag when it
 * *looks* like one — it contains a `:` (`og:image`, `twitter:card`, `article:author`) — so
 * ordinary page fields (`title`, `icon`, `mode`, `groups`) can never leak into `<head>` as
 * stray tags. An author who wants an arbitrary tag writes it in the namespaced form, which
 * is how it's spelled in the document anyway.
 */
export function frontmatterMetatags(frontmatter: PageFrontmatter): Metatags {
  const all = coerceTags(frontmatter as Record<string, unknown>);
  const out: Metatags = {};
  for (const [key, value] of Object.entries(all)) if (key.includes(":")) out[key] = value;
  return out;
}

/**
 * Resolve an authored image reference to something a crawler can fetch. External and
 * protocol-relative URLs pass through; a repo-relative path is routed through the tenant's
 * asset proxy (`withBase`) exactly like the favicon, so it resolves the same on a subdomain,
 * a custom domain and apex path mode. Next's `metadataBase` makes the result absolute.
 */
function resolveImage(url: string | undefined, assetBase: string): string | undefined {
  if (!url) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return url;
  return withBase(url.startsWith("/") ? url : `/${url}`, assetBase);
}

/**
 * The URL of the auto-generated social card for a page.
 *
 * Always root-absolute and never tenant-path-prefixed: `/api/*` is the one path space
 * middleware passes through untouched on *every* host class, so the route resolves its own
 * tenant from the Host header. Apex path mode is the exception — there the host names no
 * tenant, so the slug rides along as `?site=`, which the route honors only on the apex.
 *
 * `version` (the tenant's synced content version) is a cache-buster: X and Slack cache a
 * card by URL, so without it a re-synced page keeps unfurling its old title forever.
 */
export function ogImagePath(
  pageSlug: string,
  opts: { site?: string; version?: string } = {},
): string {
  const trimmed = pageSlug.replace(/^\/+|\/+$/g, "");
  const path = trimmed ? `/api/og/${trimmed}` : "/api/og";
  const query = new URLSearchParams();
  if (opts.site) query.set("site", opts.site);
  if (opts.version) query.set("v", opts.version);
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

export type PageSeo = {
  config: DocsConfig;
  /** The page's frontmatter. Omit for a non-MDX page (a generated OpenAPI endpoint). */
  frontmatter?: PageFrontmatter;
  /** Overrides the frontmatter title/description (used by the generated endpoint pages). */
  title?: string;
  description?: string;
  /** The page's path as served, e.g. `/guides/intro`; `""` for the index. Omit to skip canonical/og:url. */
  path?: string;
  /** Tenant asset-proxy base for repo-relative images; `""` when assets are root-absolute. */
  assetBase?: string;
  /** URL of the auto-generated card. Omit to emit no image at all. */
  ogImage?: string;
};

/**
 * Build a page's `Metadata`. The site name is NOT baked into the title here — the layout
 * owns the `%s · {site}` template, so returning a bare page title keeps one definition of
 * the suffix.
 */
export function pageMetadata(input: PageSeo): Metadata {
  const { config, frontmatter = {}, assetBase = "" } = input;
  const tags: Metatags = { ...configMetatags(config), ...frontmatterMetatags(frontmatter) };

  const title = input.title ?? frontmatter.title;
  const description = input.description ?? frontmatter.description;
  const path = input.path === undefined ? undefined : input.path || "/";

  // An authored image wins over the generated card; `twitter:image` narrows it further.
  const authored = resolveImage(tags["og:image"], assetBase);
  const image = authored ?? input.ogImage;
  const twitterImage = resolveImage(tags["twitter:image"], assetBase) ?? image;

  const ogDescription = tags["og:description"] ?? description;
  const ogUrl = tags["og:url"] ?? path;
  const twitterDescription = tags["twitter:description"] ?? description;

  const meta: Metadata = {};
  if (title) meta.title = title;
  if (description) meta.description = description;
  if (Array.isArray(frontmatter.keywords) && frontmatter.keywords.length) {
    meta.keywords = frontmatter.keywords.filter((k): k is string => typeof k === "string");
  }
  // `noindex: true` is the page-level opt-out (it already excludes the page from the search
  // index — see search.ts); honoring it here is what keeps it out of Google as well.
  if (frontmatter.noindex) meta.robots = { index: false, follow: false };
  if (path) meta.alternates = { canonical: path };

  meta.openGraph = {
    // The index page is the site itself; everything below it is a document.
    type: (tags["og:type"] as "website" | "article") ?? (path === "/" ? "website" : "article"),
    siteName: tags["og:site_name"] ?? config.name,
    title: tags["og:title"] ?? title ?? config.name,
    ...(ogDescription ? { description: ogDescription } : {}),
    ...(ogUrl ? { url: ogUrl } : {}),
    // Dimensions are declared only for OUR card, whose size we know. Declaring them for an
    // authored image would be a guess, and a wrong `og:image:width` makes X letterbox it.
    ...(image
      ? {
          images: [
            authored
              ? { url: image }
              : {
                  url: image,
                  width: OG_IMAGE_WIDTH,
                  height: OG_IMAGE_HEIGHT,
                  alt: title ? `${title} — ${config.name}` : config.name,
                },
          ],
        }
      : {}),
  };

  meta.twitter = {
    // `summary_large_image` is what turns a link into the wide card people expect from docs;
    // with no image at all there's nothing to show large, so fall back to the small card.
    card:
      (tags["twitter:card"] as "summary" | "summary_large_image") ??
      (twitterImage ? "summary_large_image" : "summary"),
    title: tags["twitter:title"] ?? title ?? config.name,
    ...(twitterDescription ? { description: twitterDescription } : {}),
    ...(twitterImage ? { images: [twitterImage] } : {}),
    ...(tags["twitter:site"] ? { site: tags["twitter:site"] } : {}),
    ...(tags["twitter:creator"] ? { creator: tags["twitter:creator"] } : {}),
  };

  // Anything else the author asked for, verbatim — the compatibility half of `seo.metatags`.
  const other: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) if (!TYPED_TAGS.has(key)) other[key] = value;
  if (Object.keys(other).length) meta.other = other;

  return meta;
}
