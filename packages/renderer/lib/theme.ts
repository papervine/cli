/**
 * Theme registry (SPEC.md §5). A docs.json `theme` value selects a named preset, matching the
 * set the docs.json schema defines so a migrated repo keeps the theme it asked for.
 *
 * A theme is *entirely* a set of CSS custom properties, emitted by `themeCssVars` and applied
 * on `<html data-theme="…">`. That is deliberate and load-bearing: the two apps that render
 * docs (the hosted site and the published CLI) keep separate `globals.css` files, so anything
 * expressed as per-theme CSS would have to be written twice and would drift. Expressed as
 * variables generated *here*, both apps get identical values for free, and adding or tuning a
 * theme stays what the original design promised — editing one entry in this file.
 *
 * The corollary is that components consume the variables rather than hard-coding: the sidebar's
 * width is `w-[var(--db-sidebar-w)]`, not `w-64`. If you find yourself wanting a `[data-theme=…]`
 * CSS rule, add a variable instead.
 *
 * Tokens stay dependency-free — system font stacks only, no webfont fetch — so a theme renders
 * identically offline, which `papervine dev` on a plane requires and the render path can't
 * negotiate.
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
  /** Heading font stack. Usually the body stack; serif or mono is what re-skins a theme most. */
  fontDisplay: string;
  /** Corner radius for controls (buttons, pills, inputs, nav links). */
  radius: string;
  /** Corner radius for surfaces (cards, code blocks, frames). */
  radiusLg: string;
  /** Heading weight. 500 reads editorial, 700 reads utilitarian. */
  headingWeight: string;
  /** Heading letter-spacing. Negative tightens display type; `0` suits mono. */
  headingTracking: string;
  /** Body line-height. Higher is airier and slower; lower is denser. */
  leading: string;
  /** Left navigation width. */
  sidebarWidth: string;
  /** Right table-of-contents width. */
  tocWidth: string;
  /** Max width of the whole three-column shell. */
  shellWidth: string;
  /** Divider between the sidebar and the content. `0px` for themes with open chrome. */
  sidebarBorder: string;
  /** Group-label casing — `uppercase` gives the terminal and enterprise looks their spine. */
  labelTransform: string;
  /** Group-label letter-spacing, which only reads deliberate when paired with uppercase. */
  labelTracking: string;
};

const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
const MONO =
  'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
// `ui-rounded` resolves to SF Pro Rounded on Apple platforms and falls through everywhere else,
// so the softer look is a progressive enhancement rather than a webfont dependency.
const ROUNDED =
  'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, system-ui, sans-serif';

export const DEFAULT_THEME: ThemeName = "mint";

/**
 * Shared baseline. Each theme below overrides only what makes it itself, so a new token gets a
 * sensible value everywhere without touching nine entries.
 */
const BASE: ThemeTokens = {
  fontSans: SANS,
  fontMono: MONO,
  fontDisplay: SANS,
  radius: "0.5rem",
  radiusLg: "0.75rem",
  headingWeight: "600",
  headingTracking: "-0.02em",
  leading: "1.75",
  sidebarWidth: "16rem",
  tocWidth: "14rem",
  shellWidth: "80rem",
  sidebarBorder: "0px",
  labelTransform: "none",
  labelTracking: "0",
};

export const themes: Record<ThemeName, ThemeTokens> = {
  /** Classic, time-tested layout — the baseline, and what an unset `theme` gets. */
  mint: { ...BASE },

  /** Modern SaaS: rounder surfaces, a wider navigation column, a visible divider. */
  maple: {
    ...BASE,
    radius: "0.625rem",
    radiusLg: "1rem",
    sidebarWidth: "18rem",
    sidebarBorder: "1px",
    shellWidth: "84rem",
  },

  /** Enterprise fintech: dense, rectilinear, heavier headings — reads like a console. */
  palm: {
    ...BASE,
    radius: "0.25rem",
    radiusLg: "0.375rem",
    headingWeight: "700",
    headingTracking: "-0.025em",
    leading: "1.65",
    sidebarWidth: "18rem",
    sidebarBorder: "1px",
    shellWidth: "84rem",
    labelTransform: "uppercase",
    labelTracking: "0.06em",
  },

  /** Stripped back: serif headings against a sans body, open chrome, a narrower measure. */
  willow: {
    ...BASE,
    fontDisplay: SERIF,
    radius: "0.375rem",
    radiusLg: "0.5rem",
    headingWeight: "500",
    headingTracking: "-0.01em",
    leading: "1.8",
    shellWidth: "76rem",
  },

  /** Retro terminal: monospace throughout, square corners, uppercase group labels. */
  linden: {
    ...BASE,
    fontSans: MONO,
    fontDisplay: MONO,
    radius: "0",
    radiusLg: "0",
    headingTracking: "0",
    leading: "1.7",
    sidebarBorder: "1px",
    labelTransform: "uppercase",
    labelTracking: "0.12em",
  },

  /** Card-based minimalism: rounded type, pill navigation, generous surfaces. */
  almond: {
    ...BASE,
    fontSans: ROUNDED,
    fontDisplay: ROUNDED,
    radius: "999px",
    radiusLg: "1.5rem",
    headingTracking: "-0.015em",
    leading: "1.8",
    sidebarWidth: "15rem",
    shellWidth: "86rem",
  },

  /** Built for deep navigation: the widest nav column, a divider, softly rounded surfaces. */
  aspen: {
    ...BASE,
    radius: "0.625rem",
    radiusLg: "0.875rem",
    sidebarWidth: "18rem",
    sidebarBorder: "1px",
    shellWidth: "82rem",
    labelTransform: "uppercase",
    labelTracking: "0.05em",
  },

  /** Editorial: serif body and headings, light weights, a long measure and airy leading. */
  sequoia: {
    ...BASE,
    fontSans: SERIF,
    fontDisplay: SERIF,
    radius: "0.375rem",
    radiusLg: "0.5rem",
    headingWeight: "500",
    headingTracking: "-0.01em",
    leading: "1.85",
    sidebarBorder: "1px",
    shellWidth: "78rem",
  },

  /** Clean and wide: the narrowest navigation, the widest content, the lightest headings. */
  luma: {
    ...BASE,
    radius: "0.625rem",
    headingWeight: "500",
    headingTracking: "-0.015em",
    leading: "1.7",
    sidebarWidth: "14rem",
    tocWidth: "13rem",
    shellWidth: "88rem",
  },
};

/** Resolve a docs.json `theme` string to a known theme, falling back to the default. */
export function resolveTheme(name?: string): { name: ThemeName; tokens: ThemeTokens } {
  const key = (name ?? "").trim().toLowerCase();
  const match = (Object.keys(themes) as ThemeName[]).find((t) => t === key);
  const resolved = match ?? DEFAULT_THEME;
  return { name: resolved, tokens: themes[resolved] };
}

/**
 * CSS variable declarations for a theme — injected into the document `<head>`.
 *
 * Every token becomes a variable; nothing about a theme lives anywhere else. The names are
 * hand-written rather than derived from the keys so that renaming a token is a compile error
 * at the call sites instead of a silently-dead variable in the stylesheets.
 */
export function themeCssVars(tokens: ThemeTokens): string {
  return [
    `--db-font-sans:${tokens.fontSans}`,
    `--db-font-mono:${tokens.fontMono}`,
    `--db-font-display:${tokens.fontDisplay}`,
    `--db-radius:${tokens.radius}`,
    `--db-radius-lg:${tokens.radiusLg}`,
    `--db-heading-weight:${tokens.headingWeight}`,
    `--db-heading-tracking:${tokens.headingTracking}`,
    `--db-leading:${tokens.leading}`,
    `--db-sidebar-w:${tokens.sidebarWidth}`,
    `--db-toc-w:${tokens.tocWidth}`,
    `--db-shell-w:${tokens.shellWidth}`,
    `--db-sidebar-border:${tokens.sidebarBorder}`,
    `--db-label-transform:${tokens.labelTransform}`,
    `--db-label-tracking:${tokens.labelTracking}`,
  ].join(";");
}
