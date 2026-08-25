import { unstable_cache } from "next/cache";
import { serialize } from "@mintlify/mdx/server";
import { run } from "@mdx-js/mdx";
import * as prodRuntime from "react/jsx-runtime";
import * as devRuntime from "react/jsx-dev-runtime";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import {
  type AuthorCodeReport,
  emptyReport,
  findDynamicImports,
  inspectEsm,
  isServerSafeExpression,
} from "./author-code";
import { ClientMdx } from "../components/ClientMdx";
import { parseCodeTitle } from "./code-title";
import type { AssetDimensions } from "./content";
import {
  CODE_TITLE_COMPONENT,
  LITERAL_IMG_COMPONENT,
  LITERAL_MEDIA_COMPONENTS,
  type LiteralMediaTag,
  applyTenantUrls,
  componentsForCompiled,
} from "./mdx-runtime";

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
 * The same rename for literal media, and for the same reason: `<video src="/videos/x.mp4">`
 * compiles to a bare `_jsx("video")`, so nothing tenant-scopes its src. Video has no component in
 * the docs.json-compatible schema — raw HTML is the portable form — so the renderer has to handle
 * the intrinsic, and reaching it means giving it a name the components map can hold.
 *
 * Renaming `<source>` matters as much as `<video>`: the src-less form puts every URL on the
 * children, and rewriting only the parent would fix nothing for it.
 */
function remarkLiteralMedia() {
  return (tree: { children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>) => {
      if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
        const renamed = LITERAL_MEDIA_COMPONENTS[node.name as LiteralMediaTag];
        if (renamed) node.name = renamed;
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

/**
 * A Markdown list inside `<Tree>`/`<FileTree>` → the `<Tree.Folder>`/`<Tree.File>` elements
 * the component actually renders.
 *
 * The list form is the second documented way to write a file tree, and the one a migrating
 * repo is more likely to use because it's far less typing:
 *
 *     <FileTree>
 *     - docs/
 *       - index.mdx
 *       - guides/
 *         - configuration.mdx
 *     - docs.config.ts
 *     </FileTree>
 *
 * Without this it degraded to a bullet list inside the tree's container — rendered, but not a
 * tree. Doing it at the mdast stage means the component only ever sees one input shape, and
 * both forms can be mixed in the same tree.
 *
 * Folder detection follows the documented rules: a trailing slash marks a folder, and so does
 * having nested items (a directory with children is a directory whether or not it was typed
 * with a slash). Folders with children open by default, matching the list form's behaviour.
 */
function remarkTreeList() {
  const textOf = (node: Record<string, unknown>): string => {
    if (typeof node.value === "string") return node.value;
    const children = node.children as Record<string, unknown>[] | undefined;
    return Array.isArray(children) ? children.map(textOf).join("") : "";
  };

  const jsx = (name: string, attrs: Record<string, string | null>, children: unknown[]) => ({
    type: "mdxJsxFlowElement",
    name,
    attributes: Object.entries(attrs).map(([key, value]) => ({
      type: "mdxJsxAttribute",
      name: key,
      value,
    })),
    children,
  });

  /** One `listItem` → a Folder (with its converted children) or a File. */
  const convertItem = (item: Record<string, unknown>): unknown => {
    const kids = (item.children as Record<string, unknown>[] | undefined) ?? [];
    // The label is the item's own inline content; nested lists are its children, not its name.
    const label = kids
      .filter((k) => k.type !== "list")
      .map(textOf)
      .join("")
      .trim();
    const nested = kids.filter((k) => k.type === "list");
    const converted = nested.flatMap((list) =>
      ((list.children as Record<string, unknown>[] | undefined) ?? []).map(convertItem),
    );

    const isFolder = label.endsWith("/") || converted.length > 0;
    const name = label.replace(/\/$/, "");
    if (!isFolder) return jsx("Tree.File", { name }, []);
    // `defaultOpen` is a boolean attribute: a null value emits it bare, as JSX expects.
    return jsx(
      "Tree.Folder",
      converted.length ? { name, defaultOpen: null } : { name },
      converted,
    );
  };

  return (tree: { children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>) => {
      const children = node.children as Record<string, unknown>[] | undefined;
      if (!Array.isArray(children)) return;
      if (
        node.type === "mdxJsxFlowElement" &&
        (node.name === "Tree" || node.name === "FileTree")
      ) {
        node.children = children.flatMap((child) =>
          child.type === "list"
            ? ((child.children as Record<string, unknown>[] | undefined) ?? []).map(convertItem)
            : [child],
        ) as Record<string, unknown>[];
        return; // converted subtree is already in final form
      }
      children.slice().forEach(visit);
    };
    const roots = tree.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(roots)) roots.slice().forEach(visit);
  };
}

/**
 * The bare code-title convention (```js Label) → a `<PvCodeTitle>` wrapper carrying the label.
 *
 * This used to rewrite `node.meta` to `title="Label"` and hope the highlighter rendered it.
 * It never did: the serializer's Shiki integration emits only `class`, `style` and `language`
 * on the `<pre>` and drops `meta` entirely, so no title ever reached the DOM and the whole
 * transform was dead code — which is also why `<CodeGroup>` labelled every tab with the
 * *language* ("shellscript" three times over) instead of npm/pnpm/yarn. Verified by probing the
 * rendered HTML for every title form before changing it.
 *
 * So the label is carried out-of-band, as a wrapper component — the same trick `remarkMermaid`
 * and `remarkTreeList` use to hand structured data to a real React component.
 */
function remarkCodeTitles() {
  return (tree: { children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>) => {
      const children = node.children as Record<string, unknown>[] | undefined;
      if (!Array.isArray(children)) return;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child || child.type !== "code") {
          visit(child as Record<string, unknown>);
          continue;
        }
        // Mermaid fences become diagrams downstream (remarkMermaid); a code-title bar wrapped
        // around a rendered diagram would be nonsense.
        if (child.lang === "mermaid") continue;

        const title = parseCodeTitle(child.meta);
        if (!title) continue;

        children[i] = {
          type: "mdxJsxFlowElement",
          name: CODE_TITLE_COMPONENT,
          attributes: [{ type: "mdxJsxAttribute", name: "title", value: title }],
          children: [child],
        };
      }
    };
    visit(tree as Record<string, unknown>);
  };
}

/**
 * Classify what the page asks the *server* to execute (SPEC §10.6).
 *
 * Runs as a remark plugin so it gets the parsed tree for free — parsing the source a second
 * time would mean a second MDX parser dependency and a second chance to disagree with the one
 * that actually compiles the page. The verdict escapes through a mutable collector because a
 * unified plugin has nowhere else to put a result.
 *
 * Placed FIRST in the chain so it sees the author's own syntax, before our transforms rewrite
 * fences into <PvCodeTitle>/<Mermaid> and literal <img> into <PvImg>. Those synthetic nodes use
 * plain string attributes, so they would classify as server-safe either way — but classifying
 * author intent rather than our own output is the honest thing to assert on.
 */
function remarkCollectAuthorCode(collector: AuthorCodeReport) {
  return (tree: { children?: unknown[] }) => {
    const estreeOf = (n: unknown) =>
      (n as { data?: { estree?: unknown } } | undefined)?.data?.estree;

    /** Judge one piece of embedded JavaScript. Anything not provably inert goes to the client. */
    const checkExpression = (estree: unknown) => {
      if (estree === undefined) return;
      collector.violations.push(...findDynamicImports(estree));
      if (!isServerSafeExpression(estree)) collector.hasAuthorCode = true;
    };

    const visit = (node: Record<string, unknown>) => {
      const estree = estreeOf(node);

      if (node.type === "mdxjsEsm") {
        const { bindings, violations } = inspectEsm(estree);
        collector.bindings.push(...bindings);
        collector.violations.push(...violations, ...findDynamicImports(estree));
        // Any author binding means author logic — the page goes to the browser.
        if (bindings.length) collector.hasAuthorCode = true;
      } else if (estree !== undefined) {
        // Every other node that carries an ESTree is embedded JavaScript: the flow and text
        // expressions, and whatever the parser adds later. Checked by *shape* rather than by a
        // list of node type names, because enumerating the list is how things get missed — the
        // first version tested `mdxJsxAttribute` only, and a JSX **spread** attribute
        // (`<Card {...process.env} />`) is a different node, so it sailed through and leaked a
        // real env var into server HTML.
        checkExpression(estree);
      }

      // Attributes carry JavaScript two ways, and both must be judged:
      //   `cols={2}`            → mdxJsxAttribute whose *value* holds the ESTree
      //   `{...props}`          → mdxJsxExpressionAttribute, which holds it *itself*
      for (const raw of (node.attributes as Record<string, unknown>[] | undefined) ?? []) {
        const attr = raw as { type?: string; value?: unknown };
        checkExpression(estreeOf(attr));
        checkExpression(estreeOf(attr.value));
      }

      for (const child of (node.children as Record<string, unknown>[] | undefined) ?? []) {
        visit(child);
      }
    };
    visit(tree as Record<string, unknown>);
  };
}

// Compile in the same dev/prod mode we run with, so the JSX runtime matches —
// mixing prod-compiled elements with React's dev renderer throws (the React 19
// bug that made us drop next-mdx-remote originally).
const mdxOptions = {
  development,
  remarkPlugins: [remarkGfm, remarkCodeTitles, remarkLiteralImg, remarkLiteralMedia, remarkMermaid, remarkTreeList],
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
  ): Promise<{ compiledSource: string; report: AuthorCodeReport } | { error: string }> => {
    try {
      // Populated by remarkCollectAuthorCode during the parse below. Cached with the compiled
      // source, so the classification costs nothing on a warm page.
      const report = emptyReport();
      const result = await serialize({
        source,
        mdxOptions: {
          ...mdxOptions,
          development: dev,
          // Tuple form: unified calls the attacher with the option, so the collector is bound
          // per compile. Passing `remarkCollectAuthorCode(report)` directly would hand unified a
          // *transformer* where it expects an attacher — it invokes it with no tree and the
          // compile throws, which degrades every page to the notice.
          remarkPlugins: [[remarkCollectAuthorCode, report], ...mdxOptions.remarkPlugins],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        syntaxHighlightingOptions,
        parseFrontmatter: false,
      });
      if (!("compiledSource" in result) || !result.compiledSource) {
        const err = (result as { error?: unknown }).error;
        return { error: err instanceof Error ? err.message : String(err ?? "MDX serialize failed") };
      }
      return { compiledSource: result.compiledSource, report };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  // Bump when the compile pipeline changes — the key is content-addressed on the *source*, so a
  // changed remark/rehype plugin set produces different output for identical input and would
  // otherwise keep serving the pre-change compile until the TTL expired.
  // v2: remarkLiteralImg; v3: remarkMermaid; v4: remarkCodeTitles emits <PvCodeTitle>;
  // v5: remarkCollectAuthorCode + the cached value gained `report`;
  // v6: the classifier judges JSX spread attributes (mdxJsxExpressionAttribute);
  // v7: remarkLiteralMedia renames literal <video>/<source>/<audio>/<iframe> so their src can be
  //     tenant-scoped — without the bump, a cached compile keeps emitting the bare intrinsic and
  //     the fix appears not to work (exactly the trap the note above describes)
  //
  // Note the *classification* is cached too, not just the compiled string — so tightening the
  // classifier without bumping this keeps serving the old verdict, and a page that should now go
  // to the client keeps being evaluated on the server. That is exactly how the spread-attribute
  // fix appeared not to work.
  ["mdx-compile-v7"],
  { revalidate: 86400 },
);


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
    const { compiledSource, report } = result;

    // A page that breaks the component contract is never evaluated at all — not here and not in
    // the browser. Refusing before execution is the point: an `import` we don't allow is an
    // import we don't want resolved anywhere.
    if (report.violations.length) {
      const detail = report.violations.map((v) => v.detail).join("; ");
      console.warn(`MDX: unsupported author code — ${detail}`);
      return <MdxNotice message={detail} />;
    }

    // THE BOUNDARY. Author logic — any `export const`, any non-literal expression — is handed to
    // the browser instead of being evaluated here. An MDX expression is real JavaScript, and
    // running it in the process that holds DATABASE_URL is how `{process.env.DATABASE_URL}` once
    // rendered a live connection string into a page. The server executes data; the client
    // executes logic. See SPEC §10.6.
    if (report.hasAuthorCode) {
      return (
        <ClientMdx
          compiledSource={compiledSource}
          development={development}
          linkBase={linkBase}
          assetBase={assetBase}
          assetDimensions={assetDimensions}
        />
      );
    }

    // No author logic: markdown, our own components and literal props only. Nothing here is
    // author-supplied *code*, so the server renders it — which is every page in practice, and
    // keeps the fast, cacheable, fully server-rendered path for real content.
    const components = applyTenantUrls(
      componentsForCompiled(compiledSource),
      linkBase,
      assetBase,
      assetDimensions,
    );
    const runtime = development ? devRuntime : prodRuntime;
    const { default: Content } = await run(compiledSource, {
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
    return <MdxNotice message={message} />;
  }
}

/**
 * The degrade-don't-500 surface, shared by the compile-failure path and the
 * unsupported-author-code path. `ClientMdx` renders the same thing in the browser, so a reader
 * sees one notice whichever side gave up.
 */
function MdxNotice({ message }: { message: string }) {
  return (
    <div className="my-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="m-0 font-medium">This page couldn’t be fully rendered yet.</p>
      {development && <p className="m-0 mt-1 font-mono text-xs opacity-80">{message}</p>}
    </div>
  );
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
