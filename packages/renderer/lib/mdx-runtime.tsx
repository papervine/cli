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
import type { ComponentProps, ReactNode } from "react";
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
    out[name] = (props: any) => <Comp {...rewrite(props)} />;
  }
  out.a = ({ href, ...rest }: ComponentProps<"a">) => <a href={withBase(href, linkBase)} {...rest} />;
  return out;
}
