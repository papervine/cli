/**
 * Theme registry (SPEC.md §5). Mirrors hosted docs platforms' named themes (`"theme"` in
 * docs.json). A theme is a small set of design tokens applied as CSS variables
 * on <html data-theme="…">, so the whole UI re-skins from one config value and
 * adding/tuning a theme means editing one entry here (plus optional per-theme
 * CSS overrides keyed on `[data-theme="…"]`).
 *
 * Tokens are intentionally dependency-free (system font stacks) so themes work
 * offline and at render time; richer presets (web fonts, layout variants) can
 * extend ThemeTokens later without changing how themes are applied.
 */
export type ThemeName =
  | "mint"
  | "maple"
  | "palm"
  | "willow"
  | "linden"
  | "almond"
  | "aspen"
  | "sequoia"
  | "luma";

export type ThemeTokens = {
  /** Body / UI font stack. */
  fontSans: string;
  /** Code / monospace font stack. */
  fontMono: string;
  /** Corner radius for controls (buttons, pills, inputs). */
  radius: string;
  /** Corner radius for surfaces (cards, code blocks, frames). */
  radiusLg: string;
};

const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
const MONO =
  'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const DEFAULT_THEME: ThemeName = "mint";

export const themes: Record<ThemeName, ThemeTokens> = {
  // Classic, time-tested layout — Papervine's baseline look.
  mint: { fontSans: SANS, fontMono: MONO, radius: "0.5rem", radiusLg: "0.75rem" },
  // Modern, clean SaaS — rounder.
  maple: { fontSans: SANS, fontMono: MONO, radius: "0.625rem", radiusLg: "1rem" },
  // Enterprise fintech — tighter, more rectilinear.
  palm: { fontSans: SANS, fontMono: MONO, radius: "0.375rem", radiusLg: "0.5rem" },
  // Stripped-back essentials.
  willow: { fontSans: SANS, fontMono: MONO, radius: "0.5rem", radiusLg: "0.625rem" },
  // Retro terminal — monospace everywhere, square corners.
  linden: { fontSans: MONO, fontMono: MONO, radius: "0", radiusLg: "0" },
  // Card-based, minimalist — very rounded surfaces.
  almond: { fontSans: SANS, fontMono: MONO, radius: "0.75rem", radiusLg: "1.25rem" },
  // Complex navigation, custom components.
  aspen: { fontSans: SANS, fontMono: MONO, radius: "0.5rem", radiusLg: "0.875rem" },
  // Elegant, content-focused — serif body.
  sequoia: { fontSans: SERIF, fontMono: MONO, radius: "0.375rem", radiusLg: "0.5rem" },
  // Clean, minimal.
  luma: { fontSans: SANS, fontMono: MONO, radius: "0.625rem", radiusLg: "0.75rem" },
};

/** Resolve a docs.json `theme` string to a known theme, falling back to the default. */
export function resolveTheme(name?: string): { name: ThemeName; tokens: ThemeTokens } {
  const key = (name ?? "").toLowerCase();
  const match = (Object.keys(themes) as ThemeName[]).find((t) => t === key);
  const resolved = match ?? DEFAULT_THEME;
  return { name: resolved, tokens: themes[resolved] };
}

/** CSS variable declarations for a theme — injected into the document <head>. */
export function themeCssVars(tokens: ThemeTokens): string {
  return [
    `--db-font-sans:${tokens.fontSans}`,
    `--db-font-mono:${tokens.fontMono}`,
    `--db-radius:${tokens.radius}`,
    `--db-radius-lg:${tokens.radiusLg}`,
  ].join(";");
}
