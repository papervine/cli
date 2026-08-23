import { describe, it, expect } from "vitest";
import { parseDocsConfig, type DocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, parsePage, type ContentSource } from "@papervine/renderer/lib/content";
import { buildNav, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";

// Regression: buildNav resolves every sidebar leaf via loadPage (one network round-trip
// per page against tenant object storage). It used to await those serially, making a
// large repo's sidebar O(pages) round-trips — 6–20s in production against R2. The leaves
// must resolve CONCURRENTLY. We prove it by giving loadPage a fixed latency and asserting
// total build time stays near a single round-trip, not pages × round-trip.

const PAGE_LATENCY_MS = 25;
const PAGE_COUNT = 40; // serial would be ~1000ms; concurrent should be ~one latency.

function flatten(nodes: (NavLeaf | NavNode)[]): NavLeaf[] {
  return nodes.flatMap((n) => ("href" in n ? [n] : flatten(n.items)));
}

function latentSource(): { source: ContentSource; config: DocsConfig; calls: () => number } {
  let calls = 0;
  const slugs = Array.from({ length: PAGE_COUNT }, (_, i) => `guide/page-${i}`);
  const { config } = parseDocsConfig({
    name: "Latency Tenant",
    navigation: { groups: [{ group: "Guide", pages: slugs }] },
  });
  return {
    config,
    calls: () => calls,
    source: {
      async loadConfig() {
        return config;
      },
      async loadPage(slug) {
        calls++;
        await new Promise((r) => setTimeout(r, PAGE_LATENCY_MS));
        return parsePage(slug, `---\ntitle: Page ${slug}\n---\nbody`);
      },
      async listPageSlugs() {
        return slugs;
      },
    },
  };
}

describe("buildNav resolves sidebar leaves concurrently", () => {
  it("builds in roughly one round-trip, not pages × round-trip", async () => {
    const { source, config, calls } = latentSource();
    const start = Date.now();
    const sections = await contentContext.run(source, () => buildNav(config));
    const elapsed = Date.now() - start;

    // All pages were fetched...
    expect(calls()).toBe(PAGE_COUNT);
    const leaves = flatten(sections.flatMap((s) => s.nodes));
    expect(leaves).toHaveLength(PAGE_COUNT);

    // ...but concurrently: serial would be PAGE_COUNT × latency (~1000ms). Allow generous
    // headroom for scheduling, but well under the serial wall.
    const serialWall = PAGE_COUNT * PAGE_LATENCY_MS;
    expect(elapsed).toBeLessThan(serialWall / 4);
  });
});