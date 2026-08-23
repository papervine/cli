import { describe, it, expect } from "vitest";
import { appearanceInitScript, themeToggleHidden } from "@papervine/renderer/lib/appearance";

describe("appearanceInitScript", () => {
  it("defaults to light when no appearance is configured", () => {
    const s = appearanceInitScript(undefined);
    expect(s).toContain('var d="light"');
    expect(s).toContain("var strict=false");
    // a stored choice is still consulted in the non-strict case
    expect(s).toContain("localStorage.getItem('theme')");
  });

  it("honors appearance.default", () => {
    expect(appearanceInitScript({ default: "dark" })).toContain('var d="dark"');
    expect(appearanceInitScript({ default: "system" })).toContain('var d="system"');
  });

  it("strict ignores the stored choice so the author's default sticks", () => {
    const s = appearanceInitScript({ default: "dark", strict: true });
    expect(s).toContain("var strict=true");
    // strict short-circuits localStorage: `strict?null:localStorage...`
    expect(s).toContain("strict?null:localStorage.getItem('theme')");
  });
});

describe("themeToggleHidden", () => {
  it("is hidden only under strict appearance", () => {
    expect(themeToggleHidden({ strict: true })).toBe(true);
    expect(themeToggleHidden({ strict: false })).toBe(false);
    expect(themeToggleHidden({ default: "dark" })).toBe(false);
    expect(themeToggleHidden(undefined)).toBe(false);
  });
});