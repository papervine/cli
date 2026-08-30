import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import matter from "gray-matter";
import { imageSize } from "image-size";
import { parseDocsConfig, type DocsConfig } from "./config";

export type PageFrontmatter = {
  title?: string;
  description?: string;
  icon?: string; // sidebar leaf icon (Lucide/docs name)
  sidebarTitle?: string; // nav label override (GAP-REPORT §3)
  url?: string; // external link — the sidebar entry opens this instead of the page
  tag?: string; // small badge shown next to the sidebar entry
  hidden?: boolean; // reachable by URL, but omitted from the sidebar
  noindex?: boolean; // exclude from search/SEO
  keywords?: string[]; // <meta name="keywords">, authored in the editor's page settings
  // Any namespaced key (`og:image`, `twitter:card`, `article:author`) is emitted as a meta
  // tag — see ./seo.ts. Typed loosely on purpose: the set is open by design (it's a
  // compatibility surface), and `frontmatterMetatags` is the one place that reads it.
  [metatag: `${string}:${string}`]: unknown;
  // Reader-auth access control (SPEC §11.2). `groups` gates the page to readers in ≥1 of the
  // listed groups (from the auth handshake); `public` opts a page out of group gating.
  // Enforced in the node render (page gate + nav hiding) — see render-tenant.tsx.
  groups?: string[];
  public?: boolean;
};

export type Page = {
  slug: string;
  frontmatter: PageFrontmatter;
  body: string; // raw MDX, compiled downstream
};

/**
 * A content source backs loadConfig/loadPage/listPageSlugs. The default is a local
 * folder (M0/single-tenant). Multi-tenant rendering (SPEC §2) swaps in a per-tenant
 * source (GitHub today, compiled bundles later) via `contentContext.run(source, …)`
 * — set once at the top of the tenant route so everything inside, including buildNav
 * (which calls loadPage for sidebar titles), reads from it without threading a source
 * argument through every signature.
 */
// Pixel dimensions for the rendered content's raster images, keyed by docs-relative path
// (e.g. `images/hero.png`, no leading slash). The renderer hands these to next/image so
// images load CLS-free and optimized; a path absent from the map degrades to a plain <img>.
export type AssetDimensions = Record<string, { width: number; height: number }>;

export type ContentSource = {
  loadConfig(): Promise<DocsConfig>;
  loadPage(slug: string): Promise<Page | null>;
  listPageSlugs(): Promise<string[]>;
  // Read a verbatim, docs-root-relative file the renderer needs as-is rather than as a parsed
  // page — today the OpenAPI/AsyncAPI spec a `docs.json` nav division points at. Returns null
  // if absent. Going through the source (instead of a direct `fs.readFile`) is what makes a
  // spec resolve the SAME way for a local `papervine dev` preview (fsSource → disk) and a
  // synced tenant (s3Source → storage); reading the filesystem directly only ever worked for
  // the former. Optional so lightweight sources (test mocks) can omit it.
  loadRaw?(relPath: string): Promise<string | null>;
  // List the docs-root-relative paths under a prefix — today, discovering the `SKILL.md` files
  // in `.papervine/skills/*/`, which have no fixed names to `loadRaw` directly. Optional for the
  // same reason `loadRaw` is: a lightweight source (a test mock, a draft preview) omits it and
  // the caller degrades to what it can address by name.
  listRaw?(prefix: string): Promise<string[]>;
  // Optional: a source that can't supply dimensions (e.g. a draft/preview) just omits it,
  // and every image falls back to a plain lazy <img>.
  loadAssetDimensions?(): Promise<AssetDimensions>;
};

export const contentContext = new AsyncLocalStorage<ContentSource>();

/** Page file extensions we serve, in resolution priority order. hosted docs platforms ships both. */
export const PAGE_EXTS = [".mdx", ".md"];

/**
 * Whether a docs-relative slug is a PAGE, as opposed to a Markdown file that lives in the docs
 * tree for some other purpose.
 *
 * Two exclusions today, both `skill.md` (SPEC §9.1): the root file, which is served at
 * `/skill.md` as an agent surface, and anything under a dot-directory, which is where multiple
 * skills live. Without this they'd render as ordinary docs pages, appear in the nav's "unlisted
 * pages" menu, and be dumped into `llms.txt` as content — a capability summary indexed as if it
 * were documentation. fsSource already skips dot-entries while walking; this is what makes the
 * storage-backed source agree with it.
 *
 * It guards `loadPage` as well as the listing, and it has to: filtering only the listing leaves
 * `/skill` rendering the file as a page for anyone who types the URL — invisible in the nav and
 * absent from llms.txt, but a live page all the same.
 */
export function isPageSlug(slug: string): boolean {
  return slug !== "skill" && !slug.startsWith(".");
}

/** Raster image extensions we measure for next/image — mirrors the sync-side RASTER_IMAGE_EXT
 *  (gif/svg excluded: animation preserved / no raster dims). Kept here too so the renderer
 *  package stays standalone (no import from the app's sync-plan). */
const RASTER_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".bmp"];

/** Parse raw file text into a Page; malformed frontmatter degrades to body-only (GAP-REPORT §S1). */
export function parsePage(slug: string, raw: string): Page {
  let data: Record<string, unknown> = {};
  let content = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data;
    content = parsed.content;
  } catch (err) {
    console.warn(`Frontmatter parse failed for ${slug}: ${(err as Error).message}`);
  }
  return { slug: slug === "/" ? "" : slug, frontmatter: data as PageFrontmatter, body: content };
}

/** Local-folder content source (default). Defaults to ./content; PAPERVINE_CONTENT overrides. */
export function fsSource(dir: string): ContentSource {
  const CONTENT_DIR = path.resolve(dir);

  async function resolveSlugToFile(slug: string): Promise<string | null> {
    const normalized = slug === "" || slug === "/" ? "index" : slug;
    for (const ext of PAGE_EXTS) {
      const target = path.normalize(path.join(CONTENT_DIR, `${normalized}${ext}`));
      if (!target.startsWith(CONTENT_DIR + path.sep)) return null; // no traversal outside dir
      try {
        await fs.access(target);
        return target;
      } catch {
        // try next extension
      }
    }
    return null;
  }

  return {
    async loadConfig() {
      const raw = await fs.readFile(path.join(CONTENT_DIR, "docs.json"), "utf8");
      const { config, warnings } = parseDocsConfig(JSON.parse(raw));
      for (const w of warnings) console.warn(`docs.json: ${w}`);
      return config;
    },
    async loadPage(slug) {
      if (!isPageSlug(slug === "" ? "" : slug)) return null;
      const file = await resolveSlugToFile(slug);
      if (!file) return null;
      return parsePage(slug, await fs.readFile(file, "utf8"));
    },
    async loadRaw(relPath) {
      const target = path.normalize(path.join(CONTENT_DIR, relPath.replace(/^\//, "")));
      if (target !== CONTENT_DIR && !target.startsWith(CONTENT_DIR + path.sep)) return null; // no traversal
      try {
        return await fs.readFile(target, "utf8");
      } catch {
        return null;
      }
    },
    async listRaw(prefix) {
      // Walks the prefix directly rather than the whole tree: the caller wants one directory,
      // and the page walk above deliberately skips the dot-directories skills live in.
      const want = prefix.replace(/^\//, "");
      const base = path.join(CONTENT_DIR, want);
      const found: string[] = [];
      async function walkAll(dir: string, rel: string) {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return; // absent directory — no skills, not an error
        }
        for (const entry of entries) {
          const next = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walkAll(path.join(dir, entry.name), next);
          else found.push(`${want}${next}`);
        }
      }
      await walkAll(base, "");
      return found;
    },
    async listPageSlugs() {
      const slugs: string[] = [];
      async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (PAGE_EXTS.some((ext) => entry.name.endsWith(ext))) {
            const rel = path.relative(CONTENT_DIR, full).replace(/\.mdx?$/, "");
            const slug = rel === "index" ? "" : rel;
            if (isPageSlug(slug)) slugs.push(slug);
          }
        }
      }
      await walk(CONTENT_DIR);
      return slugs;
    },
    async loadAssetDimensions() {
      // Measure raster images straight off disk — cheap for a local preview, and it lets the
      // dogfood `docs/` site (and the smoke fixtures) exercise the same next/image path the
      // synced tenant sites take. Unreadable images are simply skipped (plain <img> fallback).
      const dims: AssetDimensions = {};
      async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else if (RASTER_EXTS.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
            try {
              const { width, height } = imageSize(await fs.readFile(full));
              if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) {
                dims[path.relative(CONTENT_DIR, full)] = { width, height };
              }
            } catch {
              // unreadable image — skip
            }
          }
        }
      }
      await walk(CONTENT_DIR);
      return dims;
    },
  };
}

const defaultSource = fsSource(process.env.PAPERVINE_CONTENT ?? path.join(process.cwd(), "content"));

/** The active source: a tenant source if one is in scope, else the local default. */
function source(): ContentSource {
  return contentContext.getStore() ?? defaultSource;
}

// Public API — cached per request, keyed by args. Delegates to the active source.
export const loadConfig = cache((): Promise<DocsConfig> => source().loadConfig());
export const loadPage = cache((slug: string): Promise<Page | null> => source().loadPage(slug));
export const listPageSlugs = cache((): Promise<string[]> => source().listPageSlugs());
export const loadRaw = cache(
  (relPath: string): Promise<string | null> => source().loadRaw?.(relPath) ?? Promise.resolve(null),
);
export const listRaw = cache(
  (prefix: string): Promise<string[]> => source().listRaw?.(prefix) ?? Promise.resolve([]),
);
export const loadAssetDimensions = cache(
  (): Promise<AssetDimensions> => source().loadAssetDimensions?.() ?? Promise.resolve({}),
);
