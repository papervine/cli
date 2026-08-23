# @papervine/renderer

The Papervine renderer core: it turns a folder of MDX plus a `docs.json` into a docs
site. This is the shared engine behind both the `papervine` CLI and hosted Papervine,
which is what makes a repo render identically whether it's previewed locally or deployed.

> **Internal package — not published to npm** (`private: true`). It exists to keep one
> render engine shared by two apps, not as a distributable. The CLI ships *prebuilt*
> (SPEC §10.6), so this is compiled into that tarball rather than installed alongside it,
> and nothing outside this repo depends on it. Publishing it would mean committing to a
> stable public API it doesn't have — see **Shape** below. Revisit if someone actually
> wants to embed the renderer in their own app.

## What's in it

- **MDX compilation** — compiled and executed in a catchable step, so a broken page
  renders a notice instead of taking down the route. Unknown components degrade to
  their children rather than throwing.
- **`docs.json` parsing** — lenient by design: unexpected fields warn and pass
  through instead of failing the site.
- **Navigation** — the recursive `navigation` tree, tabs, sidebar, and on-page table
  of contents.
- **Components** — Cards, Tabs, Steps, Callouts, CodeGroups, Accordions, Frame,
  Expandable, Mermaid, and the API reference set.
- **OpenAPI** — endpoint reference pages generated from a referenced spec.
- **Theming** — `docs.json` colors and theme tokens as CSS variables, light and dark.

## Shape

Two things about how this package is built are deliberate, and both are why it isn't a
public package yet:

**1. It ships TypeScript/TSX source, not compiled output.** Consumers compile it, so both
apps list it in `transpilePackages`:

```js
// next.config.mjs
const nextConfig = {
  transpilePackages: ["@papervine/renderer"],
  // The MDX compiler stack breaks when webpack bundles it for RSC.
  serverExternalPackages: ["@mintlify/mdx"],
};

export default nextConfig;
```

**2. Everything is a deep subpath import.** There is intentionally no `exports` map, and
the root `index.ts` is an empty stub — import the module you want:

```ts
import { loadPage, loadConfig } from "@papervine/renderer/lib/content";
import { buildNav } from "@papervine/renderer/lib/nav";
import { Mdx, extractToc } from "@papervine/renderer/lib/mdx";
import { Sidebar } from "@papervine/renderer/components/Sidebar";
```

That keeps refactoring cheap between the two apps, at the cost of having no API surface
to version.

## Content sources

Content is read through a `ContentSource`. The default reads from a local folder —
`PAPERVINE_CONTENT`, falling back to `./content` — which is what the CLI drives. The
hosted app supplies its own per-tenant source instead.

Note that the local source computes its paths at runtime, which Next's static analysis
can't scope; that has packaging consequences documented in `apps/cli/scripts/prepack.mjs`.

## Declared dependencies matter here

Because this package is consumed through the workspace, a dependency it *uses* but
doesn't *declare* still resolves via hoisting from the repo root — and only fails when the
package is built somewhere else. Both `shiki` and `mermaid` shipped that way.

When auditing, **match dynamic imports too**. A `from "…"` grep misses
`await import("mermaid")`, which is exactly how the second one hid after the first was
found:

```bash
grep -rhoE '(from|import|require)\s*\(?\s*"[^"]+"' packages/renderer \
  --include='*.ts' --include='*.tsx' \
  | grep -oE '"[^"]+"' | tr -d '"' \
  | grep -v '^\.' | grep -v '^node:' | grep -v '^@papervine' \
  | sed -E 's|^(@[^/]+/[^/]+).*|\1|; s|^([^@/]+)/.*|\1|' | sort -u
```

Two gates catch it automatically: `npm run test:cli` (the published tarball) and
`node scripts/mirror-cli.mjs --dry-run` (which typechecks the package outside the
monorepo, where hoisting can't cover for it).
