import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, type ContentSource, type Page } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";

// `includeEmpty` exists for the editor's nav tree: a group you just created via the "+" menu has
// no pages yet, and the reader-facing build PRUNES empty groups (so a fully reader-auth-gated
// group never renders as a bare, teasing label — SPEC §11.2). Without the flag a new group was
// invisible in the tree, so you could never see it or put a page in it.
//
// The reader-facing prune is the security-adjacent half: these pin that it is unchanged when the
// flag is off, which is every non-editor caller (render path, search, docs-tools, public MCP).

const isNode = (n: NavLeaf | NavNode): n is NavNode => "items" in n;
const groupNames = (nodes: (NavLeaf | NavNode)[]) => nodes.filter(isNode).map((n) => n.group);

const PAGES: Record<string, Page["frontmatter"]> = {
  intro: { title: "Intro" },
  gated: { title: "Gated", groups: ["staff"] },
};

const withNav = (navigation: unknown) => {
  const raw = { name: "T", navigation };
  const { config } = parseDocsConfig(raw);
  const source: ContentSource = {
    async loadConfig() {
      return config;
    },
    async loadPage(slug: string) {
      const fm = PAGES[slug];
      return fm ? { slug, frontmatter: fm, body: "" } : null;
    },
    async listPageSlugs() {
      return Object.keys(PAGES);
    },
  };
  return {
    reader: () => contentContext.run(source, () => buildNav(config)),
    editor: () =>
      contentContext.run(source, () =>
        buildNav(config, "", undefined, { includeHidden: true, includeEmpty: true }),
      ),
  };
};

describe("empty groups: pruned for readers, kept for the editor", () => {
  const nav = {
    groups: [
      { group: "Filled", pages: ["intro"] },
      { group: "Brand New", pages: [] },
    ],
  };

  it("the reader build drops a group with no pages", async () => {
    const sections = await withNav(nav).reader();
    expect(groupNames(sections[0].nodes)).toEqual(["Filled"]);
  });

  it("the editor build keeps it, so it can be seen and filled", async () => {
    const sections = await withNav(nav).editor();
    expect(groupNames(sections[0].nodes)).toEqual(["Filled", "Brand New"]);
    const fresh = sections[0].nodes.filter(isNode).find((n) => n.group === "Brand New")!;
    expect(fresh.items).toEqual([]);
  });

  it("a group with no pages key at all behaves the same", async () => {
    const bare = { groups: [{ group: "Filled", pages: ["intro"] }, { group: "Bare" }] };
    expect(groupNames((await withNav(bare).reader())[0].nodes)).toEqual(["Filled"]);
    expect(groupNames((await withNav(bare).editor())[0].nodes)).toEqual(["Filled", "Bare"]);
  });

  // The prune recurses: an empty subgroup used to take its parent with it. The editor must keep
  // both, or creating a nested group would make the parent vanish too.
  it("keeps a parent whose only child group is empty", async () => {
    const nested = { groups: [{ group: "Parent", groups: [{ group: "Child", pages: [] }] }] };
    expect(await withNav(nested).reader()).toEqual([]);
    const sections = await withNav(nested).editor();
    const parent = sections[0].nodes.filter(isNode).find((n) => n.group === "Parent")!;
    expect(groupNames(parent.items)).toEqual(["Child"]);
  });
});

describe("empty groups don't weaken reader-auth pruning", () => {
  // The reason the prune exists: a group whose every page is gated must not render as a label
  // that advertises content the reader can't reach.
  it("a group whose only page is gated is still dropped for a reader without the group", async () => {
    const nav = {
      groups: [
        { group: "Public", pages: ["intro"] },
        { group: "Staff Only", pages: ["gated"] },
      ],
    };
    const { config } = parseDocsConfig({ name: "T", navigation: nav });
    const source: ContentSource = {
      async loadConfig() {
        return config;
      },
      async loadPage(slug: string) {
        const fm = PAGES[slug];
        return fm ? { slug, frontmatter: fm, body: "" } : null;
      },
      async listPageSlugs() {
        return Object.keys(PAGES);
      },
    };
    // A reader in no groups: `gated` is inaccessible. PageAccess receives the frontmatter.
    const canAccess = (fm: Page["frontmatter"]) => !fm.groups;
    const sections = await contentContext.run(source, () => buildNav(config, "", canAccess));
    expect(groupNames(sections[0].nodes)).toEqual(["Public"]);
  });
});

describe("empty tabs follow the same rule", () => {
  const nav = {
    tabs: [
      { tab: "Docs", groups: [{ group: "G", pages: ["intro"] }] },
      { tab: "Empty", groups: [] },
    ],
  };

  it("a reader never sees a tab with nothing in it", async () => {
    const sections = await withNav(nav).reader();
    expect(sections.map((s) => s.tab)).toEqual(["Docs"]);
  });

  it("the editor sees it, so a tab can be populated after it's added", async () => {
    const sections = await withNav(nav).editor();
    expect(sections.map((s) => s.tab)).toEqual(["Docs", "Empty"]);
  });
});