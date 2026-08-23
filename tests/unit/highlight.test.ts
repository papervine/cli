import { describe, it, expect } from "vitest";
import { highlightToHtml } from "@papervine/renderer/lib/highlight";

// The API reference's right-column samples are highlighted server-side with Shiki (so the
// large highlighter never ships to the client). Guard the contract: real `<pre class="shiki">`
// output, the panel-transparent background, and that it never throws on bad input (a code
// sample must never 500 an endpoint page).
describe("highlightToHtml", () => {
  it("emits Shiki markup for a JSON sample", async () => {
    const html = await highlightToHtml('{\n  "color": "red"\n}', "json");
    expect(html).toContain('class="shiki');
    expect(html).toContain("color"); // the token text survives
    expect(html).not.toContain("#24292e"); // github-dark bg replaced with transparent
  });

  it("highlights each supported language without throwing", async () => {
    for (const lang of ["bash", "javascript", "python"] as const) {
      const html = await highlightToHtml("x = 1", lang);
      expect(html).toContain("<pre");
    }
  });

  it("falls back to escaped plain text rather than throwing on an unknown grammar", async () => {
    // Cast past the typed langs to hit the catch branch (a missing grammar must degrade, not 500).
    const html = await highlightToHtml("<b>&</b>", "ruby" as "json");
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});