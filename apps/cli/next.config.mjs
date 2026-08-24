import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The CLI ships a *prebuilt* renderer: `npm publish` runs `next build` here and
  // packs the output, so `npx papervine dev` boots a compiled server instead of
  // compiling the app on every user's machine (SPEC §10.6). `standalone` is the
  // only build mode designed to be relocated to another machine — it traces the
  // imports and copies a pruned node_modules alongside the server, so the runtime
  // externals below travel with it and the published package needs no runtime
  // dependencies at all.
  output: "standalone",
  // Not `.next`: the repo gitignores `.next/` at any depth, and npm's packlist has
  // historically been inconsistent about whether a `files` entry beats a gitignore
  // rule. A distinct dist dir keeps the packed output unambiguous.
  distDir: "build",
  // Tracing must start at the monorepo root or the workspace-linked renderer (and
  // the hoisted node_modules it resolves through) is missed entirely.
  outputFileTracingRoot: path.join(APP_DIR, "..", ".."),
  // (`turbopack.root` cannot be narrowed to this app to isolate it: Next requires it to
  // equal `outputFileTracingRoot` and warns/overrides otherwise. See
  // `src/instrumentation.ts` for how the app is isolated from the monorepo's own
  // instrumentation instead.)
  // Note: `lib/content.ts` reads the docs folder through a runtime-computed path,
  // which Next's static analysis can't scope — so the build warns that it is tracing
  // the whole project, and drags the source tree and build toolchain into the output.
  // That dynamic read *is* the CLI, so the path won't become static, and
  // `outputFileTracingExcludes` does not prune it (the whole-project fallback ignores
  // it — verified on 16.3). `scripts/prepack.mjs` prunes the output explicitly instead.
  // The renderer core ships as TS/TSX source (workspace package), so Next must
  // compile it rather than treat it as a pre-built dependency.
  transpilePackages: ["@papervine/renderer"],
  // The MDX compiler stack breaks when webpack bundles it for RSC — keep it
  // external so it's required at runtime (same constraint as the web app). Being
  // external means these are `require`d rather than bundled, so file tracing is
  // what puts them in the standalone output.
  // The AI SDKs are deliberately NOT here: they bundle fine (they are ordinary JavaScript,
  // unlike the MDX stack above) and bundling is what makes them tree-shakeable and leaves no
  // second copy to reconcile. Externalising them instead produced a content-hashed alias
  // (`@ai-sdk/anthropic-<hash>`) that the compiled server requires by name — which cannot be
  // pruned, so the tarball carried the whole SDK twice over.
  serverExternalPackages: ["@mintlify/mdx", "next-mdx-remote-client"],
};

export default nextConfig;
