import { loadConfig } from "@papervine/renderer/lib/content";
import { parseDocsConfig, type DocsConfig } from "@papervine/renderer/lib/config";

/**
 * `loadConfig()` for the one caller that can run without a docs repo in scope.
 *
 * The CLI ships a *prebuilt* renderer (SPEC §10.6), so `next build` runs at publish
 * time with no `PAPERVINE_CONTENT` and no docs.json anywhere — and Next always
 * prerenders `/_not-found`, which renders the root layout. `loadConfig()` correctly
 * throws ENOENT there, which fails the build.
 *
 * So the root layout uses this instead: real config when a docs repo is present,
 * schema defaults when it isn't. The fallback is reachable *only* at build time —
 * `bin/papervine.mjs` refuses to start the server unless the target directory
 * contains a docs.json — so this cannot mask a misconfigured repo at runtime.
 *
 * Deliberately local to the CLI app: the hosted control plane wants a missing
 * docs.json to be a loud failure, so the shared renderer keeps throwing.
 */
export async function loadBuildSafeConfig(): Promise<DocsConfig> {
  try {
    return await loadConfig();
  } catch {
    return parseDocsConfig({}).config;
  }
}
