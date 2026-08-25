import { z } from "zod";

/**
 * docs.json schema (docs.json-compatible) — SPEC.md §4.
 *
 * Design rule learned from real repos (GAP-REPORT.md §1.1): this is a
 * *compatibility* layer, so validation must **warn and degrade**, never
 * hard-fail. A single unexpected field (e.g. favicon as an object) must not
 * 500 the whole site. We therefore keep the schema permissive: known fields
 * are tolerant (`.catch`) and the whole object passes unknown keys through.
 *
 * The `navigation` tree is intentionally loose here — its many division types
 * (languages, versions, tabs, anchors, dropdowns, groups, pages) are walked
 * generically in nav.ts rather than enumerated in the schema.
 */

const stringOrLightDark = z
  .union([z.string(), z.object({ light: z.string().optional(), dark: z.string().optional() }).passthrough()])
  .optional();

export const docsConfigSchema = z
  .object({
    name: z.string().catch("Docs"),
    theme: z.string().optional().catch(undefined), // named preset — see ./theme.ts
    appearance: z
      .object({
        default: z.enum(["light", "dark", "system"]).optional(),
        strict: z.boolean().optional(),
      })
      .passthrough()
      .optional()
      .catch(undefined),
    logo: stringOrLightDark.catch(undefined),
    favicon: stringOrLightDark.catch(undefined), // string OR { light, dark } — GAP-REPORT §1.1
    colors: z
      .object({
        primary: z.string().catch("#16A34A"),
        light: z.string().optional().catch(undefined),
        dark: z.string().optional().catch(undefined),
      })
      .passthrough()
      .catch({ primary: "#16A34A" }),
    navigation: z.object({}).passthrough().catch({}),
    navbar: z
      .object({
        links: z.array(z.object({ label: z.string(), href: z.string() }).passthrough()).optional(),
        primary: z.object({ label: z.string(), href: z.string() }).passthrough().optional(),
      })
      .passthrough()
      .optional()
      .catch(undefined),
    footer: z.object({}).passthrough().optional().catch(undefined),
    // Social/SEO (SPEC §4). `metatags` is an open name→content map applied to every page —
    // the site-wide way to set `og:image`, `twitter:site`, a verification token — and page
    // frontmatter overrides it per page (see ./seo.ts). Every value is coerced to a string
    // downstream, so a number or a stray nested object degrades to "ignore that one tag"
    // rather than dropping the block.
    seo: z
      .object({
        metatags: z.record(z.string(), z.unknown()).optional().catch(undefined),
        indexing: z.enum(["navigable", "all"]).optional().catch(undefined),
      })
      .passthrough()
      .optional()
      .catch(undefined),
    // Site-wide announcement bar, rendered above the navbar. `content` is the only field
    // that matters — without it there's nothing to show, so a malformed banner resolves to
    // undefined and the site renders as though it were absent, per the warn-don't-throw rule.
    banner: z
      .object({
        content: z.string(),
        dismissible: z.boolean().optional().catch(undefined),
        type: z.enum(["info", "warning", "critical"]).optional().catch(undefined),
        color: stringOrLightDark.catch(undefined),
      })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough();

export type DocsConfig = z.infer<typeof docsConfigSchema>;

/** Top-level keys Papervine actively understands; others are passed through but flagged. */
const KNOWN_KEYS = new Set([
  "$schema", "name", "theme", "appearance", "logo", "favicon", "colors",
  "navigation", "navbar", "footer", "seo",
  // Reader-auth gating (SPEC §11.2) is configured in the dashboard, not docs.json, but
  // representative docs repos may still carry an `authentication` block — pass it through
  // without a noisy warning.
  "authentication",
]);

/**
 * Parse docs.json leniently. Returns a best-effort config plus any warnings
 * (unsupported top-level keys) for surfacing in the CLI/dashboard — never throws
 * on a real config.
 */
export function parseDocsConfig(raw: unknown): { config: DocsConfig; warnings: string[] } {
  const config = docsConfigSchema.parse(raw); // .catch() on every field => won't throw
  const warnings: string[] = [];
  if (raw && typeof raw === "object") {
    const unknown = Object.keys(raw).filter((k) => !KNOWN_KEYS.has(k));
    if (unknown.length) {
      warnings.push(`Unsupported docs.json keys (ignored): ${unknown.join(", ")}`);
    }
  }
  return { config, warnings };
}
