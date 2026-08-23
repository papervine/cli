import "server-only";
import type { DocsConfig } from "./config";
import { loadPage, type PageFrontmatter } from "./content";
import { apiOperations } from "./openapi";
import { withBase } from "./url-base";

// A predicate the caller supplies to keep pages the current reader can't access out of the
// nav (SPEC §11.2 per-page `groups`). Defaults to allow-all; the tenant render passes one
// derived from the reader's session groups. Pages it rejects are dropped entirely, so a
// non-member never sees that a restricted page exists (no client-side leak).
export type PageAccess = (frontmatter: PageFrontmatter) => boolean;
const ALLOW_ALL: PageAccess = () => true;

// Threaded through the nav recursion. `includeHidden` keeps `hidden` pages/groups in the tree
// (marked `hidden: true`) instead of dropping them — the editor passes it so hiding a page just
// dims it rather than making it vanish; the published site leaves it false.
type NavCtx = { canAccess: PageAccess; includeHidden: boolean };

/** Serializable nav tree handed to the client Sidebar. `method` is set only for OpenAPI
 *  operation leaves, so the sidebar can render a colored HTTP-method badge beside them. */
export type NavLeaf = {
  title: string;
  href: string;
  method?: string;
  icon?: string; // page frontmatter `icon`
  tag?: string; // page frontmatter `tag` — a small badge
  external?: boolean; // page frontmatter `url` — opens in a new tab, not an internal route
  hidden?: boolean; // only set when includeHidden — the editor renders these dimmed
};
export type NavNode = {
  group: string;
  icon?: string;
  tag?: string; // group `tag` — a small badge
  // When true, the sidebar renders this group collapsible (chevron toggle) even at the top
  // level — used for OpenAPI tag groups, which can be long. Nested groups are always
  // collapsible regardless; this only changes the otherwise-static top-level header.
  collapsible?: boolean;
  // Group `expanded: true` (docs.json) — default the collapsible group to open.
  expanded?: boolean;
  hidden?: boolean; // only set when includeHidden — the editor renders these dimmed
  items: (NavLeaf | NavNode)[];
};
export type NavSection = {
  tab?: string;
  href?: string; // landing page for the tab (its first leaf) — what the tab links to
  hrefs: string[]; // every leaf href under this tab — used to detect the active tab
  nodes: (NavLeaf | NavNode)[];
};

type Division = Record<string, unknown>;

function titleFromSlug(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Resolve a page slug to a sidebar leaf, honoring sidebarTitle, hidden, and reader access.
 *  Null = omit (hidden, or the reader can't access it). */
async function resolveLeaf(slug: string, ctx: NavCtx): Promise<NavLeaf | null> {
  const page = await loadPage(slug);
  if (page?.frontmatter.hidden && !ctx.includeHidden) return null;
  if (page && !ctx.canAccess(page.frontmatter)) return null;
  const fm = page?.frontmatter;
  const leaf: NavLeaf = {
    title: fm?.sidebarTitle ?? fm?.title ?? titleFromSlug(slug),
    // An external `url` becomes the href directly (withBase leaves absolute URLs alone); else
    // the internal page route.
    href: fm?.url || "/" + slug,
  };
  if (fm?.url) leaf.external = true;
  if (fm?.icon) leaf.icon = fm.icon;
  if (fm?.tag) leaf.tag = fm.tag;
  if (fm?.hidden) leaf.hidden = true; // reached only when includeHidden — mark for dimming
  return leaf;
}

// Container keys whose values hold further pages/divisions, and label keys that
// name a division. Walking these generically covers hosted docs platforms' whole recursive
// navigation surface (languages → versions → tabs → anchors/dropdowns → groups
// → pages) without enumerating every combination — GAP-REPORT §1.2.
const CONTAINER_KEYS = ["pages", "groups", "anchors", "dropdowns"];
const LABEL_KEYS = ["group", "anchor", "dropdown"];

function labelOf(div: Division): string | undefined {
  for (const k of LABEL_KEYS) {
    if (typeof div[k] === "string") return div[k] as string;
  }
  return undefined;
}

const OP_SELECTOR = /^(get|post|put|patch|delete|head|options)\s+\//i;

/**
 * A division with an `openapi` property auto-generates a leaf per operation
 * (hosted docs platforms model). `pages`, if present, selects/orders endpoints by "METHOD /path"
 * (other strings are treated as normal page slugs, so manual pages can mix in).
 */
async function openapiLeaves(div: Division, ctx: NavCtx): Promise<(NavLeaf | NavNode)[]> {
  const specPath = div.openapi as string;
  const ops = await apiOperations(specPath);
  const bySelector = new Map(ops.map((op) => [`${op.method} ${op.path}`, op]));
  const leafFor = (op: (typeof ops)[number]): NavLeaf => ({
    title: op.summary ?? `${op.method} ${op.path}`,
    href: "/" + op.slug,
    method: op.method,
  });

  // Auto-generated (no explicit `pages`): group operations by their first OpenAPI tag, like
  // hosted docs platforms — each tag becomes a collapsible nav group, operations in spec order under it.
  // Tags appear in first-encounter order; untagged operations stay as bare leaves up top. A
  // spec with no tags at all falls through to a flat list (unchanged behavior).
  if (!Array.isArray(div.pages)) {
    const untagged: NavLeaf[] = [];
    const groups = new Map<string, NavLeaf[]>();
    for (const op of ops) {
      if (op.tag) {
        let items = groups.get(op.tag);
        if (!items) groups.set(op.tag, (items = []));
        items.push(leafFor(op));
      } else {
        untagged.push(leafFor(op));
      }
    }
    if (groups.size === 0) return untagged;
    const tagNodes: NavNode[] = [...groups].map(([group, items]) => ({ group, items, collapsible: true }));
    return [...untagged, ...tagNodes];
  }

  // Resolve entries concurrently (manual page entries hit loadPage — one S3 round-trip
  // each); Promise.all preserves nav order. See collectChildren for why this matters.
  const parts = await Promise.all(
    div.pages.map((entry) => {
      if (typeof entry === "string" && OP_SELECTOR.test(entry)) {
        const [method, path] = entry.split(/\s+/);
        const op = bySelector.get(`${method.toUpperCase()} ${path}`);
        return Promise.resolve(op ? [leafFor(op)] : []);
      }
      return collectItem(entry, ctx);
    }),
  );
  return parts.flat();
}

/**
 * Collect the child nav items of a division (its root + container arrays).
 *
 * Every branch is resolved CONCURRENTLY. A leaf's title comes from its page's
 * frontmatter, so each leaf is one `loadPage` — a network round-trip against the
 * tenant's object storage (R2). Resolving them serially made building the sidebar
 * O(pages) round-trips (6–20s on large repos); Promise.all collapses that to a
 * handful of batches (bounded by the S3 client's socket pool) while preserving order.
 */
async function collectChildren(div: Division, ctx: NavCtx): Promise<(NavLeaf | NavNode)[]> {
  const branches: Promise<(NavLeaf | NavNode)[]>[] = [];
  if (typeof div.root === "string") {
    branches.push(resolveLeaf(div.root, ctx).then((leaf) => (leaf ? [leaf] : [])));
  }
  if (typeof div.openapi === "string") {
    branches.push(openapiLeaves(div, ctx));
    return (await Promise.all(branches)).flat(); // openapi division: `pages` are operation selectors
  }
  for (const key of CONTAINER_KEYS) {
    const value = div[key];
    if (Array.isArray(value)) {
      branches.push(Promise.all(value.map((it) => collectItem(it, ctx))).then((r) => r.flat()));
    }
  }
  return (await Promise.all(branches)).flat();
}

/** Turn a single nav entry (slug string or division object) into nav items. */
async function collectItem(item: unknown, ctx: NavCtx): Promise<(NavLeaf | NavNode)[]> {
  if (typeof item === "string") {
    const leaf = await resolveLeaf(item, ctx);
    return leaf ? [leaf] : [];
  }
  if (item && typeof item === "object") {
    const div = item as Division;
    // A group marked `hidden: true` in docs.json is dropped from the published sidebar; the
    // editor (includeHidden) keeps it, marked, so it can be dimmed rather than lost.
    if (div.hidden === true && labelOf(div) && !ctx.includeHidden) return [];
    const children = await collectChildren(div, ctx);
    const label = labelOf(div);
    if (label) {
      // Prune a group with no surviving children — i.e. one whose every page was filtered
      // out by `canAccess` (reader-auth groups) or `hidden`. Without this a fully-gated group
      // renders as a bare label with nothing under it. Recurses naturally: an empty subgroup
      // is dropped here, so its parent sees no child and is dropped in turn. This is also how
      // a fully-gated *tab* disappears (buildNav drops a tab whose nodes are all gone) —
      // access stays single-source-of-truth at the page, and containers derive from it.
      if (children.length === 0) return [];
      const node: NavNode = { group: label, items: children };
      if (typeof div.icon === "string") node.icon = div.icon;
      if (typeof div.tag === "string") node.tag = div.tag;
      if (div.expanded === true) node.expanded = true;
      if (div.hidden === true) node.hidden = true; // reached only when includeHidden — mark for dimming
      return [node];
    }
    return children; // unlabeled wrapper — splice children up a level
  }
  return [];
}

/** Flatten a node tree to every leaf href it contains. */
function collectHrefs(nodes: (NavLeaf | NavNode)[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if ("href" in node) out.push(node.href);
    else out.push(...collectHrefs(node.items));
  }
  return out;
}

/**
 * The label of the deepest group containing `href` — hosted docs platforms shows this as an
 * "eyebrow" above the page title (e.g. "Introduction" over "Get Started").
 */
export function findGroupLabel(sections: NavSection[], href: string): string | undefined {
  let found: string | undefined;
  function walk(nodes: (NavLeaf | NavNode)[], group: string | undefined) {
    for (const node of nodes) {
      if ("href" in node) {
        if (node.href === href) found = group;
      } else {
        walk(node.items, node.group);
      }
    }
  }
  for (const section of sections) walk(section.nodes, undefined);
  return found;
}

/** Deep-prefix every leaf href in the nav with a tenant base (path-based serving). */
function prefixSections(sections: NavSection[], base: string): NavSection[] {
  const prefixNodes = (nodes: (NavLeaf | NavNode)[]): (NavLeaf | NavNode)[] =>
    nodes.map((n) =>
      "href" in n
        ? { ...n, href: withBase(n.href, base)! }
        : { ...n, items: prefixNodes(n.items) },
    );
  return sections.map((s) => ({
    ...s,
    href: withBase(s.href, base),
    hrefs: s.hrefs.map((h) => withBase(h, base)!),
    nodes: prefixNodes(s.nodes),
  }));
}

/**
 * Build the sidebar from docs.json. Unwraps the default language/version (M1
 * renders one; a switcher comes later), then renders tabs as sections.
 *
 * `base` prefixes every href for path-based tenant serving (`/sites/{slug}`); it's
 * empty in host mode (subdomain), where this is a no-op.
 */
export async function buildNav(
  config: DocsConfig,
  base = "",
  canAccess: PageAccess = ALLOW_ALL,
  opts: { includeHidden?: boolean } = {},
): Promise<NavSection[]> {
  const ctx: NavCtx = { canAccess, includeHidden: opts.includeHidden ?? false };
  let nav = config.navigation as Division;

  // Descend through localization/version wrappers to the default (first) entry.
  for (const wrapper of ["languages", "versions"]) {
    const arr = nav[wrapper];
    if (Array.isArray(arr) && arr.length && arr[0] && typeof arr[0] === "object") {
      nav = arr[0] as Division;
    }
  }

  const sections: NavSection[] = [];

  if (Array.isArray(nav.tabs) && nav.tabs.length) {
    // Resolve tabs concurrently — each descends into its own loadPage fan-out.
    const tabSections = await Promise.all(
      (nav.tabs as Division[]).map(async (tab) => {
        const nodes = await collectChildren(tab, ctx);
        const hrefs = collectHrefs(nodes);
        return {
          tab: typeof tab.tab === "string" ? tab.tab : undefined,
          href: hrefs[0],
          hrefs,
          nodes,
        };
      }),
    );
    // Drop a tab with no reachable pages — every page in it was filtered out (reader-auth
    // groups / hidden). A non-member never sees a teasing, empty "Internal" tab.
    sections.push(...tabSections.filter((s) => s.hrefs.length > 0));
  } else {
    const nodes = await collectChildren(nav, ctx);
    const hrefs = collectHrefs(nodes);
    if (hrefs.length > 0) sections.push({ hrefs, nodes });
  }

  return base ? prefixSections(sections, base) : sections;
}
