/**
 * The client-safe half of the MDX renderer: the component map, the unknown-component fallback,
 * and the tenant URL/image overrides.
 *
 * Split out of `mdx.tsx` because that module imports `next/cache`, which cannot be pulled into a
 * client bundle — and the browser evaluator (`ClientMdx`) needs exactly these pieces to render
 * author components with the same component set and the same URL rewriting the server uses.
 * Nothing here touches the filesystem, the cache or the request: it is plain React, imported by
 * both the server renderer and the client evaluator so there is one definition of each.
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import Image from "next/image";

import { mdxComponents } from "../components/mdx";
import { CodeTitle } from "../components/mdx/CodeTitle";
import type { AssetDimensions } from "./content";
import { withBase } from "./url-base";

/** Components referenced in MDX but not implemented yet render their children (GAP-REPORT §2.3). */
function FallbackComponent({ children }: { children?: ReactNode }) {
  return <>{children ?? null}</>;
}

/** Proxy so member-expression components also degrade: `<Color.Item>` → another usable component. */
const Fallback: typeof FallbackComponent = new Proxy(FallbackComponent, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    if (typeof prop === "string" && /^[A-Z]/.test(prop)) return Fallback;
    return undefined;
  },
});

const warnedComponents = new Set<string>();

// Literal `<img>` (HTML/JSX written in source) compiles to a bare `_jsx("img", …)`,
// which bypasses the MDX components map — so the tenant <img> override below (lazy +
// next/image) never sees it, unlike markdown `![]()` which compiles to
// `_jsx(_components.img, …)`. `remarkLiteralImg` renames literal img elements to this
// capitalized component name, which compiles to `_jsx(_components.PvImg, …)`; we
// register it onto the same TenantImage path. (hosted docs platforms repos author images as <img>,
// often inside <Frame> — see GAP-REPORT.) Unlikely to collide with an author component.
export const LITERAL_IMG_COMPONENT = "PvImg";
/**
 * Media has the SAME problem as literal `<img>`, and needs the same trick.
 *
 * `<video src="/videos/x.mp4">` in MDX compiles to a bare `_jsx("video", …)`, so the components
 * map never sees it and nothing rewrites its src. On a tenant host that's fine — root-relative
 * already means the tenant. Everywhere an assetBase is set it is not: path-based serving
 * (`/sites/{slug}`) and the editor's draft preview both render the tenant's MDX from a different
 * host, so the video resolved against THAT host and 404'd while the markdown image beside it
 * worked. Renaming to a capitalized name makes the compiler emit `_jsx(_components.PvVideo, …)`,
 * which applyTenantUrls can reach.
 *
 * Keyed by tag so `remarkLiteralMedia` and the overrides can't disagree about the set.
 */
export const LITERAL_MEDIA_COMPONENTS = {
  video: "PvVideo",
  source: "PvSource",
  audio: "PvAudio",
  iframe: "PvIframe",
} as const;

export type LiteralMediaTag = keyof typeof LITERAL_MEDIA_COMPONENTS;
// Synthetic name for the code-title wrapper, same rationale as PvImg: capitalized so the
// MDX compiler routes it through the components map rather than emitting a literal element.
export const CODE_TITLE_COMPONENT = "PvCodeTitle";

/**
 * Real components + a passthrough Fallback for every component the *compiled*
 * source references. Scanning compiledSource (not the raw page) is authoritative:
 * the MDX compiler emits `_missingMdxReference("Name")` for each component used,
 * including ones pulled in from resolved /snippets — so snippet-injected unknowns
 * (e.g. <Popup>) get a Fallback too and never throw at render.
 */
export function componentsForCompiled(compiledSource: string): MDXComponents {
  // Seed our synthetic literal-<img> component so the missing-reference scan below
  // doesn't flag it as an unknown component; applyTenantUrls swaps in the real one.
  const components: MDXComponents = {
    ...mdxComponents,
    [LITERAL_IMG_COMPONENT]: Fallback,
    [CODE_TITLE_COMPONENT]: CodeTitle,
    // Seeded for the same reason as PvImg: the scan below must not treat our own synthetic
    // names as unknown components. applyTenantUrls swaps in the real ones.
    ...Object.fromEntries(Object.values(LITERAL_MEDIA_COMPONENTS).map((n) => [n, Fallback])),
  };
  for (const m of compiledSource.matchAll(/_missingMdxReference\("([A-Za-z][\w.]*)"/g)) {
    const name = m[1].split(".")[0]; // root of member expressions (Foo.Bar -> Foo)
    if (!/^[A-Z]/.test(name) || name in components) continue;
    components[name] = Fallback;
    if (!warnedComponents.has(name)) {
      warnedComponents.add(name);
      console.warn(`MDX: unknown component <${name}> — rendering children only`);
    }
  }
  return components;
}

/** Coerce an author-supplied width/height (number or numeric string) to a positive int, else undefined. */
function toPosInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const RASTER_SRC_RE = /\.(png|jpe?g|webp|avif|bmp)(\?|#|$)/i;

/**
 * The renderer for content images. Three tiers, so we add performance without ever regressing
 * to a broken or wrongly-sized image:
 *   1. always lazy-load + async-decode (the dominant perceived-perf win, every type/host);
 *   2. when we know the dimensions (author-supplied or from the sync-time manifest), set
 *      width/height to reserve layout space — no CLS;
 *   3. when those dimensions exist AND the image is a same-origin raster, hand it to
 *      next/image for format negotiation (AVIF/WebP) + responsive `srcset`. gif (animation),
 *      svg, and external-host images deliberately fall through to a plain lazy <img>: next/image
 *      can't enumerate arbitrary remote hosts and would freeze a gif's first frame.
 * `dimensions` is keyed by the *original* (pre-rewrite) docs-relative path.
 */
function TenantImage({
  src,
  alt,
  width,
  height,
  assetBase,
  dimensions,
  ...rest
}: ComponentProps<"img"> & { assetBase: string; dimensions: AssetDimensions }) {
  const original = typeof src === "string" ? src : undefined;
  const rewritten = withBase(original, assetBase) ?? src;
  const authorW = toPosInt(width);
  const authorH = toPosInt(height);
  const key = original?.replace(/^\//, "");
  const manifest = key ? dimensions[key] : undefined;
  const dims = authorW && authorH ? { width: authorW, height: authorH } : manifest;

  const sameOrigin =
    typeof rewritten === "string" && rewritten.startsWith("/") && !rewritten.startsWith("//");
  const raster = !!original && RASTER_SRC_RE.test(original);

  if (dims && sameOrigin && raster) {
    return (
      <Image
        src={rewritten as string}
        alt={alt ?? ""}
        width={dims.width}
        height={dims.height}
        sizes="(max-width: 768px) 100vw, 768px"
        style={{ width: "100%", height: "auto" }}
        {...rest}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- runtime-served content asset, not a build-time import
    <img
      src={(rewritten as string) ?? undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      {...(dims ? { width: dims.width, height: dims.height } : {})}
      {...rest}
    />
  );
}

/**
 * Wire content links/images to the tenant. Two concerns:
 *   • the `img` intrinsic is ALWAYS upgraded to `TenantImage` (lazy-load + next/image) —
 *     this runs in host mode too, where `assetBase` is "" and the src rewrite is a no-op.
 *   • root-absolute link/src rewriting (`/foo` → `{base}/foo`) only applies in path-based
 *     serving (`/sites/{slug}`), where a base is set. Two emission points: raw markdown
 *     links/images (intrinsic `a`/`img`), and `href`/`src` props passed to real components
 *     (e.g. `<Card href="/quickstart">`). Fallback proxies are left alone so member-expression
 *     components still degrade.
 */
export function applyTenantUrls(
  components: MDXComponents,
  linkBase: string,
  assetBase: string,
  dimensions: AssetDimensions,
): MDXComponents {
  const out: MDXComponents = { ...components };
  out.img = (props: ComponentProps<"img">) => (
    <TenantImage {...props} assetBase={assetBase} dimensions={dimensions} />
  );
  // Literal `<img>` tags, renamed by remarkLiteralImg, render through the same override
  // so markdown and HTML images optimize identically (lazy + dimensions + next/image).
  out[LITERAL_IMG_COMPONENT] = out.img;
  // Same for literal media — before the early return, because these names have to resolve on a
  // tenant host too (where the rewrite is a no-op but the element still has to render).
  for (const [tag, name] of Object.entries(LITERAL_MEDIA_COMPONENTS)) {
    out[name] = literalMedia(tag as LiteralMediaTag, assetBase);
  }
  if (!linkBase && !assetBase) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rewrite = (props: any) => {
    if (typeof props?.href !== "string" && typeof props?.src !== "string") return props;
    const next = { ...props };
    if (typeof props.href === "string") next.href = withBase(props.href, linkBase);
    if (typeof props.src === "string") next.src = withBase(props.src, assetBase);
    return next;
  };
  // Wrap only the real (named) components — not the unknown-component Fallback proxies.
  for (const name of Object.keys(mdxComponents)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Comp = out[name] as any;
    if (!Comp) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Wrapped = (props: any) => <Comp {...rewrite(props)} />;
    // A NAMESPACE component carries its members as static properties — `Color.Item`,
    // `Tree.Folder`, `GitHub.Repo` — and a plain wrapper function has none of them. MDX compiles
    // `<Color.Item>` to a `components.Color.Item` lookup and throws "Expected component
    // `Color.Item` to be defined" when it's missing, which took the whole page down.
    //
    // It only ever broke where a base is SET, since that's the only branch that wraps: the draft
    // preview and path-based serving (`/sites/{slug}`). On a tenant host the map passes through
    // untouched, which is why every fixture and every crawl rendered a `<Tree>` perfectly while
    // the same page 500'd in Preview. The members are copied across unwrapped on purpose —
    // `rewrite` only touches `href`/`src`, and no namespace member takes either.
    Object.assign(Wrapped, Comp);
    out[name] = Wrapped;
  }
  out.a = ({ href, ...rest }: ComponentProps<"a">) => <a href={withBase(href, linkBase)} {...rest} />;

  return out;
}

/**
 * A literal media element, renamed by `remarkLiteralMedia` so it reaches this map, rendered back
 * as the real tag with its asset URLs tenant-scoped.
 *
 * Registered unconditionally — `withBase` is a no-op with an empty base, so a tenant host gets
 * byte-identical output, and the renamed element MUST always resolve to something or it would
 * fall through to the unknown-component Fallback and the video would silently vanish.
 */
function literalMedia(tag: LiteralMediaTag, assetBase: string) {
  return function LiteralMedia(props: Record<string, unknown>) {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.src === "string") next.src = withBase(props.src, assetBase);
    // `poster` is an asset too — forgetting it leaves a broken still over a working video.
    if (typeof props.poster === "string") next.poster = withBase(props.poster, assetBase);
    return createElement(tag, next);
  };
}
