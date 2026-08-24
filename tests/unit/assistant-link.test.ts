import { describe, it, expect } from "vitest";
import { assistantInternalTarget } from "@papervine/renderer/lib/assistant-link";

const ORIGIN = "https://acme.papervine.io";

// The assistant's citations must soft-navigate within the docs SPA, not open a new tab. This
// guards the internal-vs-external classification that drives that (the new-tab bug was an
// internal `/quickstart` citation being treated as external). `null` = let the browser handle
// it (same-page anchor) or open a new tab (external); a string = the in-app nav target.
describe("assistantInternalTarget", () => {
  it("treats a root-absolute docs link as internal (subdomain mode: no base)", () => {
    expect(assistantInternalTarget("/quickstart", "", ORIGIN)).toBe("/quickstart");
    expect(assistantInternalTarget("/guides/auth#tokens", "", ORIGIN)).toBe("/guides/auth#tokens");
  });

  it("prefixes the tenant base in path mode", () => {
    expect(assistantInternalTarget("/quickstart", "/sites/acme", ORIGIN)).toBe("/sites/acme/quickstart");
  });

  it("treats an absolute SAME-origin URL as internal (the new-tab bug)", () => {
    expect(assistantInternalTarget(`${ORIGIN}/quickstart`, "", ORIGIN)).toBe("/quickstart");
    expect(assistantInternalTarget(`${ORIGIN}/a/b?x=1#h`, "", ORIGIN)).toBe("/a/b?x=1#h");
  });

  it("treats a cross-origin URL as external (null → new tab)", () => {
    expect(assistantInternalTarget("https://example.com/start", "", ORIGIN)).toBeNull();
    expect(assistantInternalTarget("http://evil.test/x", "", ORIGIN)).toBeNull();
  });

  it("leaves same-page anchors to the browser (null → no intercept, no new tab)", () => {
    expect(assistantInternalTarget("#section", "", ORIGIN)).toBeNull();
  });

  it("returns null for missing or non-URL hrefs", () => {
    expect(assistantInternalTarget(undefined, "", ORIGIN)).toBeNull();
    expect(assistantInternalTarget("mailto:a@b.com", "", ORIGIN)).toBeNull();
  });
});