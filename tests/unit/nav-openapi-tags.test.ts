import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, type ContentSource } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";

// Auto-generated OpenAPI nav should GROUP operations by their tag (like hosted docs platforms) — an
// "Assets" group, an "Assettypes" group — instead of one flat list of every endpoint.

function apiSource(spec: object): ContentSource {
  const { config } = parseDocsConfig({
    name: "T",
    navigation: { groups: [{ group: "API", openapi: "openapi.json" }] },
  });
  return {
    async loadConfig() {
      return config;
    },
    async loadPage() {
      return null;
    },
    async listPageSlugs() {
      return [];
    },
    async loadRaw(relPath) {
      return relPath === "openapi.json" ? JSON.stringify(spec) : null;
    },
  };
}

const isNode = (n: NavLeaf | NavNode): n is NavNode => "items" in n;

const TAGGED = {
  openapi: "3.0.0",
  paths: {
    "/health": { get: { operationId: "health", summary: "Health check" } }, // untagged
    "/assets": {
      get: { operationId: "listAssets", summary: "List assets", tags: ["Assets"] },
      post: { operationId: "createAsset", summary: "Create asset", tags: ["Assets"] },
    },
    "/assets/{id}": {
      get: { operationId: "getAsset", summary: "Get an asset", tags: ["Assets"] },
    },
    "/assettypes": {
      get: { operationId: "listAssettypes", summary: "List assettypes", tags: ["Assettypes"] },
    },
  },
};

describe("OpenAPI nav groups operations by tag", () => {
  it("creates a nav group per tag, in first-encounter order", async () => {
    const sections = await contentContext.run(apiSource(TAGGED), () => buildNav(parsedConfigNav()));
    // The "API" group wraps the auto-generated entries.
    const api = sections[0].nodes.find((n): n is NavNode => isNode(n) && n.group === "API")!;
    expect(api).toBeTruthy();

    const groups = api.items.filter(isNode);
    expect(groups.map((g) => g.group)).toEqual(["Assets", "Assettypes"]);
    // Tag groups are collapsible so a long API can be folded by tag in the sidebar.
    expect(groups.every((g) => g.collapsible === true)).toBe(true);

    const assets = groups.find((g) => g.group === "Assets")!;
    expect((assets.items as NavLeaf[]).map((l) => l.title)).toEqual([
      "List assets",
      "Create asset",
      "Get an asset",
    ]);
    // Methods survive for the colored badge.
    expect((assets.items as NavLeaf[]).map((l) => l.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("keeps untagged operations as bare leaves above the tag groups", async () => {
    const sections = await contentContext.run(apiSource(TAGGED), () => buildNav(parsedConfigNav()));
    const api = sections[0].nodes.find((n): n is NavNode => isNode(n) && n.group === "API")!;
    const leadingLeaves = api.items.filter((n): n is NavLeaf => !isNode(n));
    expect(leadingLeaves.map((l) => l.title)).toEqual(["Health check"]);
  });

  it("falls back to a flat list when the spec has no tags (unchanged behavior)", async () => {
    const noTags = {
      openapi: "3.0.0",
      paths: { "/x": { get: { operationId: "x", summary: "X" } }, "/y": { post: { operationId: "y", summary: "Y" } } },
    };
    const sections = await contentContext.run(apiSource(noTags), () => buildNav(parsedConfigNav()));
    const api = sections[0].nodes.find((n): n is NavNode => isNode(n) && n.group === "API")!;
    expect(api.items.every((n) => !isNode(n))).toBe(true); // all leaves, no sub-groups
    expect((api.items as NavLeaf[]).map((l) => l.title)).toEqual(["X", "Y"]);
  });
});

// buildNav reads config from the content source in context; this returns the same parsed
// config the source serves, so buildNav's first arg matches what it will load.
function parsedConfigNav() {
  return parseDocsConfig({
    name: "T",
    navigation: { groups: [{ group: "API", openapi: "openapi.json" }] },
  }).config;
}