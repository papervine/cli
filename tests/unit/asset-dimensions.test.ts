import { describe, it, expect } from "vitest";
import { fsSource } from "@papervine/renderer/lib/content";

// The fsSource path (CLI preview, dogfood docs/, smoke fixtures) measures raster images
// straight off disk so they exercise the same next/image path the synced tenant sites take.
// tests/fixtures/img/hero.png is a known 120x60 PNG.
describe("fsSource.loadAssetDimensions", () => {
  it("measures raster images by docs-relative path", async () => {
    const dims = await fsSource("tests/fixtures").loadAssetDimensions!();
    expect(dims["img/hero.png"]).toEqual({ width: 120, height: 60 });
  });

  it("ignores non-raster assets (no svg/ico/gif keys)", async () => {
    const dims = await fsSource("tests/fixtures").loadAssetDimensions!();
    for (const key of Object.keys(dims)) {
      expect(key).toMatch(/\.(png|jpe?g|webp|avif|bmp)$/i);
    }
  });
});