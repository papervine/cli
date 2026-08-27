import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPage, loadConfig, loadAssetDimensions } from "@papervine/renderer/lib/content";
import { buildNav, findGroupLabel } from "@papervine/renderer/lib/nav";
import { pageMetadata, ogImagePath } from "@papervine/renderer/lib/seo";
import { loadApiCatalog } from "@papervine/renderer/lib/openapi";
import { Mdx, extractToc } from "@papervine/renderer/lib/mdx";
import { TableOfContents } from "@papervine/renderer/components/TableOfContents";
import { PageActions } from "@papervine/renderer/components/PageActions";
import { mdHref } from "@papervine/renderer/lib/llms-format";
import { aiConfigured } from "@papervine/renderer/lib/ai-model";
import { EndpointReference } from "@papervine/renderer/components/api/EndpointReference";

type Params = { slug?: string[] };

// The CLI ships this app *prebuilt* (SPEC §10.6), and the folder it renders is only
// known at runtime, from `PAPERVINE_CONTENT`. So nothing may be prerendered: a page
// baked at publish time would have been rendered against the build machine's empty
// content dir. Rendering per request is also what makes an edited MDX file show up
// on refresh — `loadPage` re-reads it from disk every time.
//
// This is why there's no `generateStaticParams` here. Enumerating the route tree at
// build time is a static-export concern, and static export belongs to the (not yet
// shipped) `papervine build` command, which will run against a known content dir.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugStr = (slug ?? []).join("/");
  const config = await loadConfig();
  const page = await loadPage(slugStr);
  // Single-repo serving: assets are root-absolute (no tenant proxy), so `assetBase` stays "".
  const op = page ? undefined : (await loadApiCatalog(config)).get(slugStr);
  if (!page && !op) return {};
  return pageMetadata({
    config,
    frontmatter: page?.frontmatter,
    title: op ? (op.summary ?? `${op.method} ${op.path}`) : undefined,
    description: op?.description,
    path: `/${slugStr}`.replace(/\/+$/, ""),
    ogImage: ogImagePath(slugStr),
  });
}

export default async function DocsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const slugStr = (slug ?? []).join("/");
  const config = await loadConfig();
  const page = await loadPage(slugStr);

  // MDX page.
  if (page) {
    const toc = extractToc(page.body);
    // Eyebrow: the group this page belongs to, shown above the title.
    const sections = await buildNav(config);
    const eyebrow = findGroupLabel(sections, "/" + (slugStr || "index"));
    // Measured off disk, and load-bearing: without it `Mdx` falls back to
    // `assetDimensions = {}`, every image degrades to a bare <img> with no width or
    // height, and nothing reaches next/image. The page still "works" — the images are
    // served, they just reflow as they load and are never optimized — which is why this
    // was missing for a while without any test noticing.
    const assetDimensions = await loadAssetDimensions();

    return (
      <div className="pv-article-row flex items-start gap-10 px-8 py-10">
        {/* The actions row sits above the article rather than inside it: `prose` styles the
            article's first child, and a control there fights those rules for margins. */}
        <div className="pv-article-col min-w-0 flex-1">
          {/* Same gate the layout puts on the navbar button: with no key configured there is
              no assistant to open, so the menu must not offer it. */}
          <PageActions mdHref={mdHref("/" + slugStr)} assistant={aiConfigured()} />
          <article className="prose min-w-0">
            {eyebrow && <div className="mb-2 text-sm font-semibold text-primary">{eyebrow}</div>}
            {page.frontmatter.title && <h1>{page.frontmatter.title}</h1>}
            {page.frontmatter.description && (
              <p className="!mt-2 text-lg text-zinc-500 dark:text-zinc-400">
                {page.frontmatter.description}
              </p>
            )}
            <Mdx source={page.body} assetDimensions={assetDimensions} />
          </article>
        </div>
        <TableOfContents items={toc} />
      </div>
    );
  }

  // Auto-generated OpenAPI endpoint page.
  const op = (await loadApiCatalog(config)).get(slugStr);
  if (op) {
    return (
      <div className="flex items-start gap-10 px-8 py-10">
        <EndpointReference op={op} baseUrl={op.baseUrl} />
      </div>
    );
  }

  notFound();
}
