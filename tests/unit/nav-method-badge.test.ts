import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, type ContentSource } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode, type NavSection } from "@papervine/renderer/lib/nav";

// The left-nav renders a colored HTTP-method badge beside each OpenAPI operation. That needs
// the method to survive into the serializable NavLeaf — `openapiLeaves` must stamp `op.method`
// onto each leaf. Guard it: a missing method silently drops the badge with no other symptom.

function apiSource(): ContentSource {
  const spec = JSON.stringify({
    openapi: "3.0.0",
    paths: {
      "/widgets": {
        get: { operationId: "listWidgets", summary: "List widgets" },
        post: { operationId: "createWidget", summary: "Create a widget" },
      },
    },
  });
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
      return relPath === "openapi.json" ? spec : null;
    },
  };
}

function leaves(nodes: (NavLeaf | NavNode)[]): NavLeaf[] {
  return nodes.flatMap((n) => ("href" in n ? [n] : leaves(n.items)));
}

describe("openapi nav leaves carry the HTTP method", () => {
  it("stamps each operation leaf with its method for the sidebar badge", async () => {
    const src = apiSource();
    const sections: NavSection[] = await contentContext.run(src, async () =>
      buildNav(await src.loadConfig(), ""),
    );
    const all = leaves(sections.flatMap((s) => s.nodes));
    const get = all.find((l) => l.title === "List widgets");
    const post = all.find((l) => l.title === "Create a widget");
    expect(get?.method).toBe("GET");
    expect(post?.method).toBe("POST");
  });
});