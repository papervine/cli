import type { Metadata } from "next";
import "./globals.css";
import { loadBuildSafeConfig } from "../lib/build-safe-config";
import { resolveTheme, themeCssVars } from "@papervine/renderer/lib/theme";

// The CLI renders a single local docs repo (the folder `papervine dev` points at,
// via PAPERVINE_CONTENT), so config reads come straight from the default content
// source — no per-tenant content-source resolution like the hosted app needs.
export async function generateMetadata(): Promise<Metadata> {
  const config = await loadBuildSafeConfig();
  return {
    title: { default: config.name, template: `%s · ${config.name}` },
  };
}

// Set the dark class before paint to avoid a flash of the wrong appearance. A
// stored user choice wins; otherwise honor docs.json `appearance.default`
// (light | dark | system) — `system` follows the OS preference.
function buildThemeScript(defaultAppearance: "light" | "dark" | "system") {
  return `(function(){try{var d=${JSON.stringify(defaultAppearance)};var s=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(s?s==='dark':(d==='dark'||(d==='system'&&m)))document.documentElement.classList.add('dark');}catch(e){}})();`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await loadBuildSafeConfig();

  const theme = resolveTheme(config.theme);
  const colors = config.colors;
  const themeVars = `:root{--color-primary:${colors.primary};--color-primary-light:${
    colors.light ?? colors.primary
  };--color-primary-dark:${colors.dark ?? colors.primary};${themeCssVars(theme.tokens)};}`;
  const themeScript = buildThemeScript(config.appearance?.default ?? "light");

  return (
    <html lang="en" data-theme={theme.name} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
