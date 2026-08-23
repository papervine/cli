import { describe, it, expect } from "vitest";
import { methodColor, methodTextColor, methodAbbrev } from "@papervine/renderer/lib/method-colors";

// The endpoint header badge and the left-nav badge share this map so a GET reads the same
// green in both places. Guard the verb→color contract and the nav abbreviations.
describe("method-colors", () => {
  it("maps known verbs to a filled badge color (case-insensitive)", () => {
    expect(methodColor("get")).toContain("green");
    expect(methodColor("POST")).toContain("blue");
    expect(methodColor("delete")).toContain("red");
    expect(methodColor("put")).toBe(methodColor("patch")); // both amber
  });

  it("falls back to zinc for an unknown verb", () => {
    expect(methodColor("TRACE")).toContain("zinc");
  });

  it("maps verbs to a text-only color for the nav badge", () => {
    expect(methodTextColor("GET")).toContain("green");
    expect(methodTextColor("WEIRD")).toContain("zinc");
  });

  it("abbreviates the long verbs that would crowd the narrow nav", () => {
    expect(methodAbbrev("DELETE")).toBe("DEL");
    expect(methodAbbrev("OPTIONS")).toBe("OPT");
    expect(methodAbbrev("get")).toBe("GET");
  });
});