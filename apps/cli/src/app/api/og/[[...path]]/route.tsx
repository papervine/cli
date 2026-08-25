import { ImageResponse } from "next/og";
import { loadConfig, loadPage } from "@papervine/renderer/lib/content";
import { loadApiCatalog } from "@papervine/renderer/lib/openapi";
import { OgCard, OG_CARD_SIZE, type OgCardInput } from "@papervine/renderer/lib/og-card";

/**
 * The auto-generated social card — `GET /api/og/{page-slug}` (SPEC §5). Referenced as
 * `og:image`/`twitter:image` by the docs route's `generateMetadata`, so a page shared from a
 * self-hosted `papervine serve` unfurls the same way it does on the hosted platform.
 *
 * The CLI serves ONE repo from `PAPERVINE_CONTENT`, so unlike the hosted app's copy there is
 * no tenant to resolve and no `?site=` — reads go straight to the default content source.
 */

// The served folder is only known at runtime, and an edited MDX file must show up on the next
// request — same reason the docs route is dynamic (see its comment).
export const dynamic = "force-dynamic";

type Params = { path?: string[] };

export async function GET(_req: Request, ctx: { params: Promise<Params> }) {
  const { path } = await ctx.params;
  const slug = (path ?? []).join("/");

  let card: OgCardInput = { siteName: "Docs" };
  try {
    const config = await loadConfig();
    const page = await loadPage(slug);
    let title = page?.frontmatter.title;
    let description = page?.frontmatter.description;
    if (!page && slug) {
      // Generated OpenAPI endpoint pages (SPEC §7) have no MDX file but are shareable URLs.
      const op = (await loadApiCatalog(config)).get(slug);
      if (op) {
        title = op.summary ?? `${op.method} ${op.path}`;
        description = op.description;
      }
    }
    card = {
      siteName: config.name,
      title,
      description,
      primary: config.colors?.primary,
      appearance: config.appearance?.default,
    };
  } catch (err) {
    // Same rule as the renderer: a bad page or unreadable config must not 500 the surface —
    // a plain card still unfurls, an error response leaves the link with no image at all.
    console.warn(`OG card fell back to the default for "${slug}": ${(err as Error).message}`);
  }

  return new ImageResponse(<OgCard {...card} />, {
    ...OG_CARD_SIZE,
    headers: {
      // Short: a self-hosted server has no content version to key on, and during
      // `papervine dev` the file on disk changes under you.
      "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
    },
  });
}
