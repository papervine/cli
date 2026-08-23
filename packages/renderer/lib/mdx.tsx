import type { ComponentProps, ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import Image from "next/image";
import { unstable_cache } from "next/cache";
import { serialize } from "@mintlify/mdx/server";
import { run } from "@mdx-js/mdx";
import * as prodRuntime from "react/jsx-runtime";
import * as devRuntime from "react/jsx-dev-runtime";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { mdxComponents } from "../components/mdx";
import type { AssetDimensions } from "./content";
import { withBase } from "./url-base";

/**
 * MDX rendering — HYBRID: compile with the serializer for Shiki dual-theme highlighting
 * + snippet handling, then execute the compiled source ourselves with @mdx-js/mdx's `run`.
 *
 * Why not their `MDXRemote`? It renders inside an RSC component and throws compile
 * errors at render time, which can't be caught without an error boundary (and a
 * boundary breaks RSC streaming). Running the compiled source ourselves keeps the
 * whole compile+execute step inside one try/catch, so an unsupported feature (e.g.
 * an unresolved /snippets import) degrades to a notice instead of 500'ing the page.
 *
 * The public surface (`Mdx`, `extractToc`) is unchanged.
 */
const development = process.env.NODE_ENV !== "production";

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
const LITERAL_IMG_COMPONENT = "PvImg";

/**
 * Real components + a passthrough Fallback for every component the *compiled*
 * source references. Scanning compiledSource (not the raw page) is authoritative:
 * the MDX compiler emits `_missingMdxReference("Name")` for each component used,
 * including ones pulled in from resolved /snippets — so snippet-injected unknowns
 * (e.g. <Popup>) get a Fallback too and never throw at render.
 */
function componentsForCompiled(compiledSource: string): MDXComponents {
  // Seed our synthetic literal-<img> component so the missing-reference scan below
  // doesn't flag it as an unknown component; applyTenantUrls swaps in the real one.
  const components: MDXComponents = { ...mdxComponents, [LITERAL_IMG_COMPONENT]: Fallback };
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

/**
 * Route literal `<img>` tags through the tenant image override. They parse to
 * `mdxJsxFlowElement`/`mdxJsxTextElement` nodes whose lowercase `name` the MDX
 * compiler emits as a literal `_jsx("img")` — skipping the components map. Renaming
 * to a capitalized component name makes the compiler emit `_jsx(_components.PvImg)`,
 * so the element takes the same TenantImage (lazy + next/image) path that markdown
 * `![]()` images already do. Attributes (src/alt/width/height) ride along unchanged.
 */
function remarkLiteralImg() {
  return (tree: { children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>) => {
      if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        node.name === "img"
      ) {
        node.name = LITERAL_IMG_COMPONENT;
      }
      const children = node.children as Record<string, unknown>[] | undefined;
      if (Array.isArray(children)) children.forEach(visit);
    };
    visit(tree as Record<string, unknown>);
  };
}

/**
 * ```mermaid fences → `<Mermaid chart="…">` so they render as diagrams, not as a highlighted
 * code block. Runs at the mdast stage, before Shiki highlighting, so Shiki
 * never sees the fence. The raw source rides as a string attribute, which the MDX compiler
 * lowers to a JS string literal (`_jsx(Mermaid, { chart: "…" })`) — so arbitrary content
 * (newlines, `<br/>`, quotes, `&amp;`) is escaped for free, no JSX-in-text hazards.
 */
function remarkMermaid() {
  return (tree: { children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>, index: number, parent: Record<string, unknown>) => {
      if (node.type === "code" && node.lang === "mermaid") {
        (parent.children as unknown[])[index] = {
          type: "mdxJsxFlowElement",
          name: "Mermaid",
          attributes: [{ type: "mdxJsxAttribute", name: "chart", value: node.value }],
          children: [],
        };
        return;
      }
      const children = node.children as Record<string, unknown>[] | undefined;
      // Snapshot before iterating so an in-place replacement above is safe.
      if (Array.isArray(children)) children.slice().forEach((child, i) => visit(child, i, node));
    };
    const roots = tree.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(roots)) roots.slice().forEach((child, i) => visit(child, i, tree as Record<string, unknown>));
  };
}

/** hosted docs platforms' bare code-title convention (```js Label) → rehype/highlighter title="Label". */
function remarkCodeTitles() {
  return (tree: { children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>) => {
      if (node.type === "code" && typeof node.meta === "string") {
        const meta = node.meta.trim();
        if (meta && !meta.includes("=") && !meta.startsWith("{")) {
          node.meta = `title="${meta}"`;
        }
      }
      const children = node.children as Record<string, unknown>[] | undefined;
      if (Array.isArray(children)) children.forEach(visit);
    };
    visit(tree as Record<string, unknown>);
  };
}

// Compile in the same dev/prod mode we run with, so the JSX runtime matches —
// mixing prod-compiled elements with React's dev renderer throws (the React 19
// bug that made us drop next-mdx-remote originally).
const mdxOptions = {
  development,
  remarkPlugins: [remarkGfm, remarkCodeTitles, remarkLiteralImg, remarkMermaid],
  rehypePlugins: [rehypeSlug, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
} as const;

const syntaxHighlightingOptions = {
  themes: { light: "github-light", dark: "github-dark" },
  codeStyling: "system",
} as const;

/**
 * Compile MDX → compiled-source string, cached in the Data Cache. The compile (Shiki
 * dual-theme highlighting) is the page render's CPU cost; its output depends only on
 * the source text + the dev/prod flag (the tenant `base` rewriting happens later, on
 * the components), so it's content-addressed — a changed page body is a new key. No
 * tag/TTL needed: the key changes when the content does. Returns a discriminated result
 * (errors aren't thrown across the cache boundary) so the caller keeps its try/catch.
 */
const compileMdx = unstable_cache(
  async (
    source: string,
    dev: boolean,
  ): Promise<{ compiledSource: string } | { error: string }> => {
    try {
      const result = await serialize({
        source,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mdxOptions: { ...mdxOptions, development: dev } as any,
        syntaxHighlightingOptions,
        parseFrontmatter: false,
      });
      if (!("compiledSource" in result) || !result.compiledSource) {
        const err = (result as { error?: unknown }).error;
        return { error: err instanceof Error ? err.message : String(err ?? "MDX serialize failed") };
      }
      return { compiledSource: result.compiledSource };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  ["mdx-compile-v3"], // bump when the compile pipeline changes (v2: remarkLiteralImg; v3: remarkMermaid)
  { revalidate: 86400 },
);

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
function applyTenantUrls(
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

export async function Mdx({
  source,
  linkBase = "",
  assetBase = "",
  assetDimensions = {},
}: {
  source: string;
  linkBase?: string;
  assetBase?: string;
  assetDimensions?: AssetDimensions;
}) {
  try {
    const result = await compileMdx(source, development);
    if ("error" in result) throw new Error(result.error);

    const components = applyTenantUrls(
      componentsForCompiled(result.compiledSource),
      linkBase,
      assetBase,
      assetDimensions,
    );
    const runtime = development ? devRuntime : prodRuntime;
    const { default: Content } = await run(result.compiledSource, {
      ...(runtime as Parameters<typeof run>[1]),
      useMDXComponents: () => components,
      baseUrl: import.meta.url,
    });

    return <Content components={components} />;
  } catch (err) {
    // Don't let a single unsupported feature (e.g. an unresolved /snippets import,
    // GAP-REPORT §2.2) 500 the page — degrade to an inline notice.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`MDX render failed: ${message}`);
    return (
      <div className="my-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="m-0 font-medium">This page couldn’t be fully rendered yet.</p>
        {development && <p className="m-0 mt-1 font-mono text-xs opacity-80">{message}</p>}
      </div>
    );
  }
}

/** Extract h2/h3 headings from raw MDX for the right-hand table of contents. */
export type TocItem = { depth: number; text: string; id: string };

export function extractToc(source: string): TocItem[] {
  const toc: TocItem[] = [];
  const lines = source.split("\n");
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      const depth = match[1].length;
      const text = match[2].replace(/[*_`]/g, "");
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      toc.push({ depth, text, id });
    }
  }
  return toc;
}
