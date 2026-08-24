import { describe, expect, it } from "vitest";
import { reduceSearch } from "@papervine/renderer/lib/search-track";

describe("reduceSearch — collapse a keystroke-prefix chain to one search intent", () => {
  it("never commits while typing a single term forward (the ~8-events bug)", () => {
    // Replay each debounced prefix of "analytics"; only `pending` advances.
    let pending = "";
    const commits: string[] = [];
    for (const prefix of ["a", "an", "ana", "anal", "analy", "analyt", "analyti", "analytics"]) {
      const r = reduceSearch(pending, prefix);
      pending = r.pending;
      if (r.commit) commits.push(r.commit);
    }
    expect(commits).toEqual([]); // zero events mid-type...
    expect(pending).toBe("analytics"); // ...just the most specific form held for later
  });

  it("treats backspacing within a term as the same search", () => {
    expect(reduceSearch("analytics", "analyt")).toEqual({ pending: "analytics", commit: null });
  });

  it("keeps the more specific form regardless of edit direction", () => {
    expect(reduceSearch("analyt", "analytics").pending).toBe("analytics");
    expect(reduceSearch("analytics", "analy").pending).toBe("analytics");
  });

  it("commits the previous search when the user switches to an unrelated term", () => {
    expect(reduceSearch("analytics", "billing")).toEqual({ pending: "billing", commit: "analytics" });
  });

  it("does not start a search from empty / whitespace input", () => {
    expect(reduceSearch("", "")).toEqual({ pending: "", commit: null });
    expect(reduceSearch("", "   ")).toEqual({ pending: "", commit: null });
    expect(reduceSearch("", "analytics")).toEqual({ pending: "analytics", commit: null });
  });

  it("holds the pending query when the box is cleared (so close still logs it)", () => {
    expect(reduceSearch("analytics", "")).toEqual({ pending: "analytics", commit: null });
  });

  it("ignores surrounding whitespace when comparing", () => {
    expect(reduceSearch("  analytics ", "analytics")).toEqual({ pending: "analytics", commit: null });
  });
});