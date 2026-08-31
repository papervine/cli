import { describe, expect, it } from "vitest";
import { docsConfigSchema, parseDocsConfig } from "@papervine/renderer/lib/config";

/**
 * `parseDocsConfig` warns on top-level keys Papervine doesn't act on — the warn-don't-throw
 * contract (GAP-REPORT §1.1). The warning is shown to site owners in the CLI and the editor, so
 * it has to mean what it says: a key that IS acted on must never be reported as ignored.
 *
 * `banner` was, for its whole life. It's declared in the schema, parsed, and rendered site-wide
 * above the navbar — and it was missing from `KNOWN_KEYS`, so every site using one was told the
 * feature it could see working was "unsupported (ignored)". The advice that warning implies —
 * delete the key — would have removed a working banner.
 *
 * The second test is the durable half: rather than pinning today's list, it asserts the
 * invariant that every field the schema declares is a field the warning stays quiet about, so
 * the next config field added can't reintroduce this.
 */
describe("docs.json config warnings", () => {
  it("does not flag a supported banner as unsupported", () => {
    const { config, warnings } = parseDocsConfig({
      name: "Acme",
      banner: { content: "Version 2.0 is live.", type: "info", dismissible: true },
    });

    expect(warnings).toEqual([]);
    expect(config.banner?.content).toBe("Version 2.0 is live.");
  });

  it("stays quiet about every field the schema declares", () => {
    // One key at a time: a warning names the offending keys, so a per-key parse says exactly
    // which field is missing from the known set rather than "one of these thirteen".
    for (const key of Object.keys(docsConfigSchema.shape)) {
      const { warnings } = parseDocsConfig({ name: "Acme", [key]: {} });
      expect(warnings, `docs.json "${key}" is parsed but reported as unsupported`).toEqual([]);
    }
  });

  it("still flags a key nothing acts on", () => {
    const { warnings } = parseDocsConfig({ name: "Acme", redirects: [] });
    expect(warnings).toEqual(["Unsupported docs.json keys (ignored): redirects"]);
  });
});