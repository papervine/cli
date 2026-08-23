import { describe, it, expect } from "vitest";
import {
  playgroundHref,
  playgroundRequested,
  playgroundUrl,
} from "@papervine/renderer/lib/playground-url";
import { withBase } from "@papervine/renderer/lib/url-base";

// Navigating between endpoint pages remounts the playground (same route file, but the App Router
// rebuilds the subtree), so its open state can't ride along in component state. The in-modal
// operation switcher therefore links with a flag the next mount reads back — without it, picking a
// sibling operation dumps you on that endpoint with the playground shut, which is the one thing the
// switcher exists to avoid.

describe("playgroundHref", () => {
  it("links to the operation with the playground flag", () => {
    expect(playgroundHref("get-user")).toBe("/get-user?playground=open");
  });

  it("is a query parameter, not a hash — docs pages use the hash for heading anchors", () => {
    expect(playgroundHref("list-users")).not.toContain("#");
  });

  it("round-trips through URL parsing as a readable flag", () => {
    const url = new URL(playgroundHref("create-user"), "https://docs.example.com");
    expect(url.pathname).toBe("/create-user");
    expect(playgroundRequested(url.search)).toBe(true);
  });
});

describe("playgroundRequested", () => {
  it("reads the flag off a query string, and only that flag", () => {
    expect(playgroundRequested("?playground=open")).toBe(true);
    expect(playgroundRequested("?a=1&playground=open&b=2")).toBe(true);
    expect(playgroundRequested("")).toBe(false);
    expect(playgroundRequested("?a=1")).toBe(false);
    expect(playgroundRequested("?playgrounds=open")).toBe(false);
  });
});

// The URL should keep describing what's on screen — including after the reader closes the
// playground, or a refresh would reopen something they dismissed.
describe("playgroundUrl", () => {
  const page = "https://docs.example.com/get-user";

  it("adds and removes the flag", () => {
    expect(playgroundUrl(page, true)).toBe(`${page}?playground=open`);
    expect(playgroundUrl(`${page}?playground=open`, false)).toBe(page);
  });

  it("leaves the site's own query parameters alone", () => {
    expect(playgroundUrl(`${page}?ref=email`, true)).toBe(`${page}?ref=email&playground=open`);
    expect(playgroundUrl(`${page}?ref=email&playground=open`, false)).toBe(`${page}?ref=email`);
  });

  it("keeps the hash, which is a heading anchor", () => {
    expect(playgroundUrl(`${page}#response`, true)).toBe(`${page}?playground=open#response`);
  });

  it("is idempotent", () => {
    const on = playgroundUrl(page, true);
    expect(playgroundUrl(on, true)).toBe(on);
    expect(playgroundUrl(page, false)).toBe(page);
  });
});

// In apex path mode a tenant's docs live under `/sites/{slug}`, and every internal link is
// base-prefixed. The switcher's link is internal like any other: a bare `/get-user` would leave
// the tenant for the platform apex, taking the reader off their own docs.
describe("switcher links under a tenant base", () => {
  it("prefixes the operation link, flag and all", () => {
    expect(withBase(playgroundHref("get-user"), "/sites/acme")).toBe(
      "/sites/acme/get-user?playground=open",
    );
  });

  it("is a no-op on the tenant's own host, where the base is empty", () => {
    expect(withBase(playgroundHref("get-user"), "")).toBe("/get-user?playground=open");
  });
});