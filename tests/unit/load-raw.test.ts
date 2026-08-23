import { describe, it, expect } from "vitest";
import { fsSource } from "@papervine/renderer/lib/content";

// `loadRaw` is how the renderer reads a verbatim, docs-root-relative file (today: the
// OpenAPI spec a `docs.json` nav division points at). Routing OpenAPI through the active
// ContentSource — instead of a direct `fs.readFile(CONTENT_DIR, …)` — is what makes a spec
// resolve the SAME for a local preview (fsSource → disk) and a synced tenant (s3Source →
// storage); reading the filesystem directly only ever worked for the former, so OpenAPI
// silently failed for connected tenant sites (SPEC §7). These guard the fsSource impl.
describe("fsSource.loadRaw", () => {
  const src = fsSource("tests/fixtures");

  it("reads a docs-relative file verbatim", async () => {
    const raw = await src.loadRaw!("openapi.json");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).openapi).toBe("3.0.0");
  });

  it("normalizes a leading slash", async () => {
    expect(await src.loadRaw!("/openapi.json")).toBe(await src.loadRaw!("openapi.json"));
  });

  it("returns null for a missing file (never throws)", async () => {
    expect(await src.loadRaw!("does-not-exist.json")).toBeNull();
  });

  it("refuses to escape the content dir (no path traversal)", async () => {
    // package.json exists one level up; the guard must still return null, not its contents.
    expect(await src.loadRaw!("../package.json")).toBeNull();
    expect(await src.loadRaw!("../../etc/passwd")).toBeNull();
  });
});