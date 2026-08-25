import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import {
  configMetatags,
  frontmatterMetatags,
  ogImagePath,
  pageMetadata,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
} from "@papervine/renderer/lib/seo";
import { originFromHost } from "@papervine/renderer/lib/origin";

const config = (extra: Record<string, unknown> = {}) =>
  parseDocsConfig({ name: "Acme Docs", colors: { primary: "#2563EB" }, ...extra }).config;

describe("ogImagePath", () => {
  it("addresses the index page as the bare route", () => {
    expect(ogImagePath("")).toBe("/api/og");
    expect(ogImagePath("/")).toBe("/api/og");
  });

  it("appends the page slug", () => {
    expect(ogImagePath("guides/intro")).toBe("/api/og/guides/intro");
    expect(ogImagePath("/guides/intro/")).toBe("/api/og/guides/intro");
  });

  it("carries the slug + content version as query params", () => {
    expect(ogImagePath("guides/intro", { site: "acme", version: "1700" })).toBe(
      "/api/og/guides/intro?site=acme&v=1700",
    );
    // The version is the cache-buster: X caches a card by URL, so a re-sync must mint a new one.
    expect(ogImagePath("", { version: "1700" })).toBe("/api/og?v=1700");
  });
});

describe("metatag extraction", () => {
  it("reads docs.json seo.metatags and coerces scalars to strings", () => {
    const c = config({ seo: { metatags: { "og:image": "/social.png", "twitter:site": "@acme", n: 3 } } });
    expect(configMetatags(c)).toEqual({ "og:image": "/social.png", "twitter:site": "@acme", n: "3" });
  });

  it("survives a malformed seo block (compatibility layer: warn, don't throw)", () => {
    expect(configMetatags(config({ seo: "nope" }))).toEqual({});
    expect(configMetatags(config({ seo: { metatags: ["a"] } }))).toEqual({});
    expect(configMetatags(config())).toEqual({});
  });

  it("treats only namespaced frontmatter keys as meta tags", () => {
    expect(
      frontmatterMetatags({
        title: "Intro",
        icon: "rocket",
        hidden: true,
        "og:image": "/custom.png",
        "article:author": "Ada",
      }),
    ).toEqual({ "og:image": "/custom.png", "article:author": "Ada" });
  });
});

describe("pageMetadata", () => {
  const base = () =>
    pageMetadata({
      config: config(),
      frontmatter: { title: "Quickstart", description: "Get running in five minutes." },
      path: "/guides/quickstart",
      ogImage: "/api/og/guides/quickstart",
    });

  it("emits a large-image twitter card pointing at the generated image", () => {
    const meta = base();
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Quickstart",
      description: "Get running in five minutes.",
      images: ["/api/og/guides/quickstart"],
    });
  });

  it("declares the generated card's dimensions (X letterboxes a wrong size)", () => {
    expect(base().openGraph?.images).toEqual([
      {
        url: "/api/og/guides/quickstart",
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        alt: "Quickstart — Acme Docs",
      },
    ]);
  });

  it("returns a BARE title — the layout owns the `%s · site` template", () => {
    expect(base().title).toBe("Quickstart");
  });

  it("sets a canonical URL and og:type article for an inner page, website for the index", () => {
    expect(base().alternates?.canonical).toBe("/guides/quickstart");
    expect(base().openGraph).toMatchObject({ type: "article", url: "/guides/quickstart" });
    const index = pageMetadata({ config: config(), frontmatter: { title: "" }, path: "" });
    expect(index.openGraph).toMatchObject({ type: "website", url: "/" });
    expect(index.alternates?.canonical).toBe("/");
  });

  it("falls back to the site name when a page has no title", () => {
    const meta = pageMetadata({ config: config(), path: "/x", ogImage: "/api/og/x" });
    expect(meta.title).toBeUndefined(); // the layout's `default` supplies it
    expect(meta.openGraph?.title).toBe("Acme Docs");
    expect(meta.twitter).toMatchObject({ title: "Acme Docs" });
  });

  it("has no image tags at all when no card is offered", () => {
    const meta = pageMetadata({ config: config(), frontmatter: { title: "X" }, path: "/x" });
    expect(meta.openGraph?.images).toBeUndefined();
    // Nothing to show large → the small card, not a broken large one.
    expect(meta.twitter).toMatchObject({ card: "summary" });
  });
});

describe("pageMetadata precedence", () => {
  it("prefers a page's og:image over the site's, and the site's over the generated card", () => {
    const c = config({ seo: { metatags: { "og:image": "/site-card.png" } } });
    const siteWide = pageMetadata({ config: c, frontmatter: { title: "A" }, ogImage: "/api/og/a" });
    expect(siteWide.openGraph?.images).toEqual([{ url: "/site-card.png" }]);

    const perPage = pageMetadata({
      config: c,
      frontmatter: { title: "A", "og:image": "/page-card.png" },
      ogImage: "/api/og/a",
    });
    expect(perPage.openGraph?.images).toEqual([{ url: "/page-card.png" }]);
  });

  it("does NOT declare dimensions for an authored image (we don't know its size)", () => {
    const meta = pageMetadata({
      config: config(),
      frontmatter: { title: "A", "og:image": "/page-card.png" },
      ogImage: "/api/og/a",
    });
    expect(meta.openGraph?.images).toEqual([{ url: "/page-card.png" }]);
  });

  it("routes a repo-relative authored image through the tenant asset proxy", () => {
    const meta = pageMetadata({
      config: config(),
      frontmatter: { title: "A", "og:image": "images/card.png" },
      assetBase: "/api/tenant-asset/acme",
    });
    expect(meta.openGraph?.images).toEqual([{ url: "/api/tenant-asset/acme/images/card.png" }]);
  });

  it("leaves an absolute authored image alone", () => {
    const meta = pageMetadata({
      config: config(),
      frontmatter: { title: "A", "og:image": "https://cdn.example.com/card.png" },
      assetBase: "/api/tenant-asset/acme",
    });
    expect(meta.openGraph?.images).toEqual([{ url: "https://cdn.example.com/card.png" }]);
  });

  it("lets twitter:image narrow the card without changing og:image", () => {
    const meta = pageMetadata({
      config: config(),
      frontmatter: { title: "A", "twitter:image": "/tw.png" },
      ogImage: "/api/og/a",
    });
    expect(meta.twitter).toMatchObject({ images: ["/tw.png"] });
    expect(meta.openGraph?.images).toMatchObject([{ url: "/api/og/a" }]);
  });

  it("honors an explicit twitter:card, handle and creator", () => {
    const meta = pageMetadata({
      config: config({ seo: { metatags: { "twitter:site": "@acme", "twitter:creator": "@ada" } } }),
      frontmatter: { title: "A", "twitter:card": "summary" },
      ogImage: "/api/og/a",
    });
    expect(meta.twitter).toMatchObject({ card: "summary", site: "@acme", creator: "@ada" });
  });

  it("passes unrecognised metatags through verbatim, exactly once", () => {
    const meta = pageMetadata({
      config: config({ seo: { metatags: { "google-site-verification": "abc", "og:image": "/x.png" } } }),
      frontmatter: { title: "A" },
    });
    expect(meta.other).toEqual({ "google-site-verification": "abc" });
  });

  it("honors noindex and keywords", () => {
    const meta = pageMetadata({
      config: config(),
      frontmatter: { title: "A", noindex: true, keywords: ["a", "b"] },
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.keywords).toEqual(["a", "b"]);
  });
});

describe("originFromHost", () => {
  it("infers http for local hosts and https for real ones", () => {
    expect(originFromHost("localhost:3000")).toBe("http://localhost:3000");
    expect(originFromHost("acme.localhost:3000")).toBe("http://acme.localhost:3000");
    expect(originFromHost("127.0.0.1:4178")).toBe("http://127.0.0.1:4178");
    expect(originFromHost("acme.papervine.page")).toBe("https://acme.papervine.page");
    expect(originFromHost("docs.example.com")).toBe("https://docs.example.com");
  });

  it("trusts a forwarded protocol, taking the client-facing one from a list", () => {
    expect(originFromHost("acme.papervine.page", "http")).toBe("http://acme.papervine.page");
    expect(originFromHost("docs.example.com", "https, http")).toBe("https://docs.example.com");
  });

  it("returns null rather than throwing on a missing or malformed Host", () => {
    expect(originFromHost(null)).toBeNull();
    expect(originFromHost("")).toBeNull();
    expect(originFromHost("   ")).toBeNull();
    expect(originFromHost("no spaces allowed")).toBeNull();
  });
});