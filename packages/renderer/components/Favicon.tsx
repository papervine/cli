import type { ReactElement } from "react";
import type { DocsConfig } from "../lib/config";
import { withBase } from "../lib/url-base";

/**
 * Emit `<link rel="icon">` from docs.json `favicon`. The value is either a single path or a
 * `{ light, dark }` pair (hosted docs platforms convention); for a pair we key each icon on the OS
 * `prefers-color-scheme` so the favicon tracks light/dark the way hosted docs platforms' does. Paths are
 * tenant-scoped through `assetBase` (the `/api/tenant-asset/{slug}` proxy in subdomain/path/
 * custom-domain modes; empty — a no-op — on the apex, where assets are root-absolute).
 *
 * Rendered into the document <head> by the root layout, which resolves `favicon`/`assetBase`
 * from the request's tenant content source.
 */
export function Favicon({
  favicon,
  assetBase = "",
}: {
  favicon: DocsConfig["favicon"];
  assetBase?: string;
}): ReactElement | null {
  if (!favicon) return null;
  if (typeof favicon === "string") {
    return <link rel="icon" href={withBase(favicon, assetBase)} />;
  }
  const light = favicon.light ? withBase(favicon.light, assetBase) : undefined;
  const dark = favicon.dark ? withBase(favicon.dark, assetBase) : undefined;
  return (
    <>
      {light && <link rel="icon" href={light} media="(prefers-color-scheme: light)" />}
      {dark && <link rel="icon" href={dark} media="(prefers-color-scheme: dark)" />}
    </>
  );
}
