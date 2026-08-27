import { describe, expect, it } from "vitest";
import {
  formatLlmsFullPage,
  formatLlmsIndex,
  headingsFor,
  linkLine,
  mdHref,
  specPaths,
  truncate,
} from "../../packages/renderer/lib/llms-format";
import type { PageEntry } from "@papervine/renderer/lib/docs-tools";

const page = (over: Partial<PageEntry> & Pick<PageEntry, "title" | "href">): PageEntry => ({
  groups: [],
  ...over,
});

describe("mdHref", () => {
  it("appends .md to a page route", () => {
    expect(mdHref("/quickstart")).toBe("/quickstart.md");
    expect(mdHref("/guides/auth")).toBe("/guides/auth.md");
  });

  // The index page is served at `/`, so the naive rewrite yields `/.md` — a path that reads
  // like a dotfile and that relative-link resolvers mangle. It gets the explicit spelling.
  it("spells the index page's twin /index.md", () => {
    expect(mdHref("/")).toBe("/index.md");
  });
});

describe("truncate", () => {
  it("leaves a short description alone", () => {
    expect(truncate("Short and sweet.")).toBe("Short and sweet.");
  });

  it("collapses whitespace so a wrapped frontmatter string stays one line", () => {
    expect(truncate("two\n   lines  here")).toBe("two lines here");
  });

  it("caps at the limit with an ellipsis", () => {
    const out = truncate("x".repeat(400));
    expect(out).toHaveLength(300);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("specPaths", () => {
  it("finds specs at any depth and in every shape docs.json allows", () => {
    expect(
      specPaths({
        tabs: [
          { tab: "Docs", groups: [{ group: "Start", pages: ["index"] }] },
          { tab: "API", openapi: "api/openapi.json" },
          { tab: "Events", groups: [{ group: "Async", asyncapi: { source: "api/async.yaml" } }] },
          { tab: "Both", openapi: ["a.json", "b.json"] },
        ],
      }),
    ).toEqual(["api/openapi.json", "api/async.yaml", "a.json", "b.json"]);
  });

  it("skips externally hosted specs — they aren't ours to advertise as part of this site", () => {
    expect(specPaths({ openapi: "https://example.com/openapi.json" })).toEqual([]);
  });

  it("deduplicates a spec referenced by more than one division", () => {
    expect(specPaths({ tabs: [{ openapi: "api.json" }, { openapi: "api.json" }] })).toEqual([
      "api.json",
    ]);
  });

  it("returns nothing for a nav with no specs, and tolerates junk", () => {
    expect(specPaths({ pages: ["a", "b"] })).toEqual([]);
    expect(specPaths(null)).toEqual([]);
    expect(specPaths({ openapi: 42 })).toEqual([]);
  });
});

describe("headingsFor", () => {
  it("opens a heading per new trail level, deepening as it nests", () => {
    expect(headingsFor(["Guides", "Auth"], [])).toEqual([
      "",
      "## Guides",
      "",
      "",
      "### Auth",
      "",
    ]);
  });

  it("emits nothing while the trail is unchanged", () => {
    expect(headingsFor(["Guides"], ["Guides"])).toEqual([]);
  });

  it("re-opens only the levels that actually changed", () => {
    expect(headingsFor(["Guides", "Billing"], ["Guides", "Auth"])).toEqual(["", "### Billing", ""]);
  });

  // A four-deep tree would otherwise reach `#####`, which clients render as noise.
  it("caps the heading level at h4", () => {
    expect(headingsFor(["A", "B", "C", "D"], []).filter((l) => l.startsWith("#"))).toEqual([
      "## A",
      "### B",
      "#### C",
      "#### D",
    ]);
  });
});

describe("linkLine", () => {
  it("points an internal link at the .md twin and appends the description", () => {
    expect(linkLine("https://d.example", page({ title: "Auth", href: "/auth", description: "How." })))
      .toBe("- [Auth](https://d.example/auth.md): How.");
  });

  it("leaves an external link absolute and un-suffixed — there is no .md of someone else's page", () => {
    expect(
      linkLine("https://d.example", page({ title: "Blog", href: "https://x.example", external: true })),
    ).toBe("- [Blog](https://x.example)");
  });
});

describe("formatLlmsIndex", () => {
  const origin = "https://docs.example";

  it("renders the llmstxt.org shape: H1, blockquote summary, then sections", () => {
    const out = formatLlmsIndex({
      origin,
      name: "Acme Docs",
      description: "Everything about Acme.",
      entries: [
        page({ title: "Introduction", href: "/", groups: ["Get started"], description: "Start here." }),
        page({ title: "Install", href: "/install", groups: ["Get started"] }),
        page({ title: "Tokens", href: "/auth/tokens", groups: ["Guides", "Auth"] }),
      ],
    });
    expect(out).toBe(
      [
        "# Acme Docs",
        "",
        "> Everything about Acme.",
        "",
        "## Get started",
        "",
        `- [Introduction](${origin}/index.md): Start here.`,
        `- [Install](${origin}/install.md)`,
        "",
        "## Guides",
        "",
        "### Auth",
        "",
        `- [Tokens](${origin}/auth/tokens.md)`,
        "",
      ].join("\n"),
    );
  });

  // Each emitter pads itself with a blank line, so a group whose first child is a nested group
  // ("## Guides" then "### Auth") would otherwise leave a double blank mid-file.
  it("collapses blank-line runs and ends with exactly one newline", () => {
    const out = formatLlmsIndex({
      origin,
      name: "Acme",
      entries: [page({ title: "Tokens", href: "/t", groups: ["A", "B", "C"] })],
    });
    expect(out).not.toContain("\n\n\n");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("emits owner instructions verbatim, after the summary", () => {
    const out = formatLlmsIndex({
      origin,
      name: "Acme",
      description: "Summary.",
      instructions: "Always cite the version you read.",
      entries: [page({ title: "Home", href: "/" })],
    });
    expect(out.indexOf("> Summary.")).toBeLessThan(out.indexOf("Always cite"));
    expect(out).toContain("Always cite the version you read.");
  });

  // A site with no groups at all must still produce a section, or the links dangle under the
  // H1 with no heading — which is not the llms.txt shape and reads as a truncated file.
  it("gives ungrouped pages a Docs heading", () => {
    const out = formatLlmsIndex({
      origin,
      name: "Acme",
      entries: [page({ title: "Home", href: "/" }), page({ title: "About", href: "/about" })],
    });
    expect(out).toContain("## Docs");
    expect(out).toContain(`- [Home](${origin}/index.md)`);
  });

  it("still produces a section when there are no pages at all", () => {
    expect(formatLlmsIndex({ origin, name: "Empty", entries: [] })).toBe("# Empty\n\n## Docs\n");
  });

  it("collects external links into a trailing Optional section, out of nav order", () => {
    const out = formatLlmsIndex({
      origin,
      name: "Acme",
      entries: [
        page({ title: "Blog", href: "https://blog.example", external: true, groups: ["Get started"] }),
        page({ title: "Install", href: "/install", groups: ["Get started"] }),
      ],
    });
    expect(out.indexOf("- [Install]")).toBeLessThan(out.indexOf("## Optional"));
    expect(out).toContain("## Optional\n\n- [Blog](https://blog.example)");
  });

  it("lists spec files and unlisted pages in their own sections", () => {
    const out = formatLlmsIndex({
      origin,
      name: "Acme",
      entries: [page({ title: "Home", href: "/" })],
      unlisted: [page({ title: "Changelog", href: "/changelog" })],
      specs: ["api/openapi.json"],
    });
    expect(out).toContain(`## Additional pages\n\n- [Changelog](${origin}/changelog.md)`);
    expect(out).toContain(`## API specifications\n\n- [openapi.json](${origin}/api/openapi.json)`);
  });

  it("omits every optional section when there's nothing to put in it", () => {
    const out = formatLlmsIndex({ origin, name: "Acme", entries: [page({ title: "H", href: "/" })] });
    for (const heading of ["## Optional", "## Additional pages", "## API specifications", ">"]) {
      expect(out).not.toContain(heading);
    }
  });
});

describe("formatLlmsFullPage", () => {
  it("cites the .md twin as the source, not the HTML page", () => {
    expect(
      formatLlmsFullPage(
        "https://docs.example",
        page({ title: "Auth", href: "/auth", description: "How." }),
        "  Body text.  ",
      ),
    ).toEqual([
      "",
      "---",
      "",
      "# Auth",
      "Source: https://docs.example/auth.md",
      "Description: How.",
      "",
      "Body text.",
    ]);
  });
});