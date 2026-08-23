import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import type { DocsConfig } from "../lib/config";
import { themeToggleHidden } from "../lib/appearance";
import { withBase } from "../lib/url-base";

/**
 * Render the docs logo from docs.json. `logo` is either a single path or a
 * `{ light, dark }` pair (hosted docs platforms convention — light logo on light backgrounds,
 * dark on dark). We toggle the pair with CSS so it tracks the theme without JS.
 * Falls back to the site name as text when no logo is configured.
 */
function Logo({ logo, name, assetBase }: { logo: DocsConfig["logo"]; name: string; assetBase: string }) {
  if (typeof logo === "string") {
    // eslint-disable-next-line @next/next/no-img-element -- runtime-served content asset, not a build-time import
    return <img src={withBase(logo, assetBase)} alt={name} className="h-7 w-auto" />;
  }
  if (logo && (logo.light || logo.dark)) {
    return (
      <>
        {logo.light && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={withBase(logo.light, assetBase)} alt={name} className="h-7 w-auto dark:hidden" />
        )}
        {logo.dark && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={withBase(logo.dark, assetBase)} alt={name} className="hidden h-7 w-auto dark:block" />
        )}
      </>
    );
  }
  return <span>{name}</span>;
}

/**
 * `base`/`assetBase` prefix internal links and content assets for path-based tenant
 * serving (`/sites/{slug}`); both empty in host mode (subdomain), where this is a no-op.
 */
export function Navbar({
  config,
  base = "",
  assetBase = "",
  search,
  assistant,
}: {
  config: DocsConfig;
  base?: string;
  assetBase?: string;
  /** Optional search palette slot — the host app supplies its implementation
   *  (the renderer core has no search backend of its own). Omitted → no palette. */
  search?: ReactNode;
  /** Optional "Ask AI" slot — supplied by hosts that wire up an assistant. */
  assistant?: ReactNode;
}) {
  const links = config.navbar?.links ?? [];
  const primary = config.navbar?.primary;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      {/* Padding on the max-w-7xl element itself (not a full-width wrapper) so the
          left edge matches the content row exactly at any viewport width. */}
      <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-6 pl-9 pr-6">
        <Link href={base || "/"} className="flex shrink-0 items-center text-lg font-bold text-zinc-900 dark:text-zinc-100">
          <Logo logo={config.logo} name={config.name} assetBase={assetBase} />
        </Link>

        {/* Search palette — absolutely centered so the logo/actions widths don't skew it.
            Host-supplied (see `search` prop); the renderer core ships no search backend. */}
        {search}

        <div className="ml-auto flex items-center gap-1">
          {assistant}
          {links.map((link) => (
            <Link
              key={link.href}
              href={withBase(link.href, base) ?? link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {link.label}
            </Link>
          ))}
          {primary && (
            <Link
              href={withBase(primary.href, base) ?? primary.href}
              className="ml-2 rounded-[var(--db-radius)] bg-primary px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              {primary.label}
            </Link>
          )}
          {/* `appearance.strict` locks the site to its default mode — hide the toggle. */}
          {!themeToggleHidden(config.appearance) && <ThemeToggle />}
        </div>
      </div>
    </header>
  );
}
