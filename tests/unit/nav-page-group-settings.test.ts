import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, type ContentSource, type Page } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";

// The Page/Group settings panels write frontmatter + docs.json keys; these assert the renderer
// actually CONSUMES them in the sidebar nav: page icon, tag badge, external url; group hidden
// (dropped), expanded (default-open flag), and tag.

const isNode = (n: NavLeaf | NavNode): n is NavNode => "items" in n;

const PAGES: Record<string, Page["frontmatter"]> = {
  intro: { title: "Intro", icon: "rocket" },
  external: { title: "External", url: "https://example.com/x" },
  tagged: { title: "Tagged", tag: "New" },
  secretpage: { title: "Secret Page", hidden: true },
};

const NAV = {
  name: "T",
  navigation: {
    groups: [
      { group: "Guides", pages: ["intro", "external", "tagged", "secretpage"] },
      { group: "Secret", hidden: true, pages: ["intro"] },
      { group: "API", expanded: true, tag: "Beta", pages: ["intro"] },
    ],
  },
};

function source(): ContentSource {
  const { config } = parseDocsConfig(NAV);
  return {
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
}

const build = () => contentContext.run(source(), () => buildNav(parseDocsConfig(NAV).config));
// The editor builds with includeHidden so hidden items stay (dimmed) instead of vanishing.
const buildEditor = () =>
  contentContext.run(source(), () => buildNav(parseDocsConfig(NAV).config, "", undefined, { includeHidden: true }));

describe("nav consumes Page/Group settings", () => {
  it("renders a page icon and a page tag on the leaf", async () => {
    const nodes = (await build())[0].nodes;
    const guides = nodes.find((n): n is NavNode => isNode(n) && n.group === "Guides")!;
    const leaves = guides.items as NavLeaf[];
    expect(leaves.find((l) => l.title === "Intro")?.icon).toBe("rocket");
    expect(leaves.find((l) => l.title === "Tagged")?.tag).toBe("New");
  });

  it("turns a page `url` into an external leaf", async () => {
    const nodes = (await build())[0].nodes;
    const guides = nodes.find((n): n is NavNode => isNode(n) && n.group === "Guides")!;
    const ext = (guides.items as NavLeaf[]).find((l) => l.title === "External")!;
    expect(ext.external).toBe(true);
    expect(ext.href).toBe("https://example.com/x");
  });

  it("drops a hidden group entirely", async () => {
    const nodes = (await build())[0].nodes;
    expect(nodes.find((n) => isNode(n) && n.group === "Secret")).toBeUndefined();
  });

  it("carries group `expanded` and `tag`", async () => {
    const nodes = (await build())[0].nodes;
    const api = nodes.find((n): n is NavNode => isNode(n) && n.group === "API")!;
    expect(api.expanded).toBe(true);
    expect(api.tag).toBe("Beta");
  });

  it("published build drops hidden pages AND groups", async () => {
    const guides = (await build())[0].nodes.find((n): n is NavNode => isNode(n) && n.group === "Guides")!;
    expect((guides.items as NavLeaf[]).some((l) => l.title === "Secret Page")).toBe(false);
    expect((await build())[0].nodes.some((n) => isNode(n) && n.group === "Secret")).toBe(false);
  });

  it("editor build (includeHidden) KEEPS hidden pages + groups, marked hidden", async () => {
    const nodes = (await buildEditor())[0].nodes;
    const guides = nodes.find((n): n is NavNode => isNode(n) && n.group === "Guides")!;
    const secretPage = (guides.items as NavLeaf[]).find((l) => l.title === "Secret Page");
    expect(secretPage?.hidden).toBe(true);
    const secretGroup = nodes.find((n): n is NavNode => isNode(n) && n.group === "Secret");
    expect(secretGroup?.hidden).toBe(true);
  });
});