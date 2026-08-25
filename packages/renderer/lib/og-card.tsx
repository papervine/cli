import type { ReactElement } from "react";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "./seo";

/**
 * The auto-generated social card (SPEC §5) — the image a docs link unfurls to on X, Slack,
 * LinkedIn and iMessage when the repo hasn't supplied one of its own.
 *
 * Rendered by `next/og` (satori), which is NOT a browser: only a flexbox subset of CSS is
 * supported, every element with children needs an explicit `display: flex`, and there is no
 * layout-dependent text truncation. So text is clamped in JS *before* it reaches the tree
 * (`clamp` below) rather than with `line-clamp`, and every style here is inline.
 *
 * Deliberately **font-free**: `next/og` ships one bundled face (Geist Regular) and we pass no
 * `fonts` option, so the card renders identically on Vercel, in `papervine serve` and inside
 * the published CLI tarball with no font file to trace, bundle, or lose to `npm pack`. The
 * hierarchy is carried by size, color and spacing instead of weight — which is why the title
 * is nearly 3× the site name rather than merely bolder.
 *
 * Branding comes from the two things every `docs.json` has: `colors.primary` and
 * `appearance.default` (a dark-by-default site unfurls a dark card).
 */

/** Truncate on a word boundary and add an ellipsis — satori can't clamp by line. */
function clamp(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type OgCardInput = {
  /** The docs site's name — always shown, so a card is branded even with nothing else. */
  siteName: string;
  /** The page title. Omit on the index, where the site name is the headline. */
  title?: string;
  /** The page description. */
  description?: string;
  /** `docs.json` → `colors.primary`. */
  primary?: string;
  /**
   * `docs.json` → `appearance.default`. A card is a static image with no `prefers-color-scheme`
   * to consult, so it can't track the *viewer's* theme — but a site that ships dark by default
   * should still unfurl dark rather than flashing a white card in a dark timeline. `system`
   * resolves to light, the safer of the two against unknown surfaces.
   */
  appearance?: "light" | "dark" | "system";
};

export const OG_CARD_SIZE = { width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT };

export function OgCard({
  siteName,
  title,
  description,
  primary = "#16A34A",
  appearance,
}: OgCardInput): ReactElement {
  const dark = appearance === "dark";
  const palette = dark
    ? { bg: "#0a0a0a", headline: "#fafafa", body: "#a1a1aa", name: "#e4e4e7", wash: "3d" }
    : { bg: "#ffffff", headline: "#0a0a0a", body: "#525252", name: "#171717", wash: "2e" };
  // On the index there is no page title, so the site name IS the headline — printing it
  // again in the footer reads like a bug, so the footer only appears on inner pages.
  const headline = clamp(title || siteName, 90);
  const hasTitle = Boolean(title);
  const body = description ? clamp(description, 160) : "";
  // The corner wash appends an alpha byte, which is only valid on a 6-digit hex — `colors` is a
  // lenient compatibility field (any CSS color, or garbage), so anything else renders flat
  // rather than handing satori a malformed gradient to throw on. It's anchored OFF-canvas and
  // faded out well before the edge because satori rasterises a gradient in visible bands, and a
  // stop that lands inside the frame draws that band as a hard arc.
  const wash = /^#[0-9a-f]{6}$/i.test(primary)
    ? `radial-gradient(circle at 105% -15%, ${primary}${palette.wash} 0%, ${primary}00 78%)`
    : undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: palette.bg,
        // A wash of the site's own color in the corner — enough to make two different
        // customers' cards read as different brands without tinting the text behind it.
        ...(wash ? { backgroundImage: wash } : {}),
        padding: "76px 80px 64px",
        position: "relative",
      }}
    >
      {/* The one saturated element: a rule across the top in the site's primary color. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_IMAGE_WIDTH,
          height: 14,
          backgroundColor: primary,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            fontSize: headline.length > 44 ? 66 : 82,
            lineHeight: 1.12,
            letterSpacing: -1.5,
            color: palette.headline,
          }}
        >
          {headline}
        </div>

        {body ? (
          <div
            style={{
              display: "flex",
              fontSize: 32,
              lineHeight: 1.4,
              color: palette.body,
              marginTop: 28,
            }}
          >
            {body}
          </div>
        ) : null}
      </div>

      {hasTitle ? (
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              backgroundColor: primary,
              marginRight: 16,
            }}
          />
          <div style={{ display: "flex", fontSize: 28, color: palette.name, letterSpacing: -0.2 }}>
            {clamp(siteName, 60)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
