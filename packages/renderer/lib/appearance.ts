/**
 * docs.json `appearance` (docs.json-compatible) — the docs/marketing light/dark behavior.
 * Kept as pure, dependency-free helpers so the pre-paint script and the toggle-visibility
 * rule share one source of truth and can be unit-tested without a DOM.
 *
 * NOTE: this is the *docs* appearance (the `.dark` class, `localStorage['theme']`), which
 * is independent of the platform/control-plane theme (`data-db-theme`, `pv-theme`).
 */

export type Appearance = {
  /** Initial color mode when the reader has no stored choice. Default: "light". */
  default?: "light" | "dark" | "system";
  /** Lock the site to `default` — the reader can't switch (the toggle is hidden). */
  strict?: boolean;
};

/**
 * Inline script that sets the `.dark` class on <html> before first paint, avoiding a flash
 * of the wrong appearance. Resolution mirrors hosted docs platforms' `appearance`:
 *
 *  - `strict: true` → always the configured `default`; any stored choice is ignored
 *    (the UI also hides the toggle — see `themeToggleHidden`), so the author's mode sticks.
 *  - otherwise a stored choice (`localStorage['theme']`) wins; absent it, `default`
 *    (light | dark | system), where `system` follows the OS `prefers-color-scheme`.
 *
 * Returned as a string for `dangerouslySetInnerHTML` in the document <head>.
 */
export function appearanceInitScript(appearance?: Appearance): string {
  const d = appearance?.default ?? "light";
  const strict = appearance?.strict === true;
  return `(function(){try{var d=${JSON.stringify(
    d,
  )};var strict=${strict};var s=strict?null:localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(s?s==='dark':(d==='dark'||(d==='system'&&m)))document.documentElement.classList.add('dark');}catch(e){}})();`;
}

/**
 * Whether the appearance toggle should be hidden. hosted docs platforms `appearance.strict` locks the
 * site to its default appearance, so there's nothing to toggle.
 */
export function themeToggleHidden(appearance?: Appearance): boolean {
  return appearance?.strict === true;
}
