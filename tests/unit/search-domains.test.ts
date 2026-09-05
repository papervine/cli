import { describe, expect, it } from "vitest";
import { parseSearchDomain } from "@papervine/renderer/lib/assistant-settings";
import {
  discoveryUrls,
  htmlToText,
  markdownHrefs,
  readAllowedUrl,
  scoreText,
  searchSite,
  sitemapLocs,
} from "@papervine/renderer/lib/search-domains";

function textResponse(url: string, body: string, contentType = "text/plain"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
    // Response.url is read-only in some runtimes; our fetch wrapper uses res.url || request url.
  });
}

describe("htmlToText / extractors", () => {
  it("strips scripts and tags", () => {
    expect(htmlToText("<html><script>alert(1)</script><h1>Hello</h1><p>world</p></html>")).toBe(
      "Hello world",
    );
  });

  it("pulls loc entries and markdown links", () => {
    expect(sitemapLocs("<urlset><url><loc>https://docs.example.com/a</loc></url></urlset>")).toEqual([
      "https://docs.example.com/a",
    ]);
    expect(markdownHrefs("# Index\n\n- [Auth](https://docs.example.com/auth)\n")).toEqual([
      "https://docs.example.com/auth",
    ]);
  });
});

describe("scoreText", () => {
  it("scores term overlap and returns a nearby snippet", () => {
    const { score, snippet } = scoreText("Deploy with papervine serve after you write docs.json", "papervine serve");
    expect(score).toBe(2);
    expect(snippet.toLowerCase()).toContain("papervine");
  });
});

describe("discoveryUrls", () => {
  it("tries llms.txt and sitemap on the host, plus a path prefix when set", () => {
    expect(discoveryUrls(parseSearchDomain("docs.example.com")!)).toEqual([
      "https://docs.example.com/llms.txt",
      "https://docs.example.com/sitemap.xml",
      "https://docs.example.com/",
    ]);
    expect(discoveryUrls(parseSearchDomain("docs.example.com/api")!)).toEqual([
      "https://docs.example.com/api/llms.txt",
      "https://docs.example.com/api",
      "https://docs.example.com/llms.txt",
      "https://docs.example.com/sitemap.xml",
    ]);
  });

  it("expands a wildcard to the apex and www", () => {
    expect(discoveryUrls(parseSearchDomain("*.example.com")!)).toContain("https://example.com/llms.txt");
    expect(discoveryUrls(parseSearchDomain("*.example.com")!)).toContain(
      "https://www.example.com/llms.txt",
    );
  });
});

describe("searchSite / readAllowedUrl", () => {
  const patterns = [parseSearchDomain("docs.example.com")!];

  it("returns hits from llms.txt and refuses off-domain URLs", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://docs.example.com/llms.txt") {
        return textResponse(
          url,
          "# Docs\n\n- [Auth](https://docs.example.com/auth)\n- [Billing](https://evil.test/steal)\n",
        );
      }
      return new Response("nope", { status: 404 });
    };

    const hits = await searchSite("auth", patterns, fetchImpl);
    expect(Array.isArray(hits)).toBe(true);
    if (Array.isArray(hits)) {
      expect(hits.some((h) => h.url.includes("/auth"))).toBe(true);
      expect(hits.some((h) => h.url.includes("evil.test"))).toBe(false);
    }
  });

  it("readUrl refuses a host that is not on the allowlist", async () => {
    const got = await readAllowedUrl("https://evil.test/x", patterns, async () => {
      throw new Error("should not fetch");
    });
    expect(got).toEqual({ error: "URL is not on a configured search domain." });
  });

  it("readUrl returns plain text from an allowed page", async () => {
    const got = await readAllowedUrl("https://docs.example.com/auth", patterns, async () =>
      textResponse("https://docs.example.com/auth", "<h1>Auth</h1><p>Rotate tokens weekly.</p>", "text/html"),
    );
    expect("body" in got && got.body).toContain("Rotate tokens weekly");
  });

  it("refuses a redirect that leaves the allowlist", async () => {
    const got = await readAllowedUrl("https://docs.example.com/go", patterns, async () => {
      return {
        ok: true,
        status: 200,
        url: "https://evil.test/landed",
        headers: new Headers({ "content-type": "text/plain" }),
        arrayBuffer: async () => new TextEncoder().encode("secret").buffer,
      } as Response;
    });
    expect(got).toEqual({ error: "Redirect left the allowed domains." });
  });
});
