import { describe, it, expect } from "vitest";
import { withBase } from "@papervine/renderer/lib/url-base";

const BASE = "/sites/acme";

describe("withBase", () => {
  it("prefixes root-absolute internal URLs", () => {
    expect(withBase("/quickstart", BASE)).toBe("/sites/acme/quickstart");
    expect(withBase("/", BASE)).toBe("/sites/acme/");
    expect(withBase("/img/hero.png", "/api/tenant-asset/acme")).toBe(
      "/api/tenant-asset/acme/img/hero.png",
    );
  });

  it("leaves external and protocol-relative URLs untouched", () => {
    expect(withBase("https://x.com/y", BASE)).toBe("https://x.com/y");
    expect(withBase("http://x.com", BASE)).toBe("http://x.com");
    expect(withBase("//cdn.x.com/a.png", BASE)).toBe("//cdn.x.com/a.png");
    expect(withBase("mailto:a@b.com", BASE)).toBe("mailto:a@b.com");
  });

  it("leaves anchors, queries and relative URLs untouched", () => {
    expect(withBase("#section", BASE)).toBe("#section");
    expect(withBase("?q=1", BASE)).toBe("?q=1");
    expect(withBase("nested/page", BASE)).toBe("nested/page");
  });

  it("is a no-op when base is empty (host mode) or url is missing", () => {
    expect(withBase("/quickstart", "")).toBe("/quickstart");
    expect(withBase(undefined, BASE)).toBeUndefined();
    expect(withBase("", BASE)).toBe("");
  });
});