<div align="center">
  <a href="https://papervine.io">
    <h2><b>Papervine CLI</b></h2>
  </a>
  <p>
    Mintlify compatible alternative. Open source MDX documentation.
  </p>
  <p>

[![npm](https://img.shields.io/npm/v/papervine?logo=npm)](https://www.npmjs.com/package/papervine) [![Website](https://img.shields.io/website?url=https%3A%2F%2Fpapervine.io)](https://papervine.io)

  </p>
</div>

### Installation

```
npm i -g papervine
```

Requires Node 20.9 or higher. Or skip the install and run it directly:

```
npx papervine@latest dev
```

The CLI ships a **prebuilt** renderer, so there's no toolchain to download and no
first-run compile — it starts serving immediately.

### Local preview

#### `papervine dev [dir]`

Serve the docs in `[dir]`, defaulting to the current directory. The directory must
contain a `docs.json` at its root.

```
papervine dev
```

**Options**

| Flag                | Description                | Default |
| ------------------- | -------------------------- | ------- |
| `-p, --port <port>` | Port to serve on           | `3000`  |
| `-h, --help`        | Show help                  | —       |

**Preview a subfolder**

Docs usually live in a subdirectory of a larger repo:

```
papervine dev ./docs
```

**Custom port**

```
papervine dev --port 4000
```

Without `--port`, if `3000` is taken the CLI moves to the next free port. With an
explicit `--port` it fails instead of silently serving somewhere you didn't ask for.

**Editing**

Pages are rendered per request, so saving an `.mdx` file and refreshing the browser
shows the change. There is no hot reload — a refresh is the update.

By default the preview binds loopback (`127.0.0.1`) rather than every interface. Set
`HOSTNAME=0.0.0.0` to reach it from outside the machine, e.g. from a container host.

### What ships in this package

Just the renderer: MDX compilation, `docs.json` parsing, navigation, the component
set, and OpenAPI endpoint pages — the same engine that serves hosted Papervine sites,
compiled in.

It carries **none** of the hosted product: no authentication, database, object
storage, realtime, or AI assistant. Those are services of a hosted deployment, not
things a local previewer needs, so they are absent from the package rather than
disabled at runtime — nothing to install, and nothing to audit.

One visible consequence: the navbar's search palette and "Ask AI" button are hosted
features, so a local preview shows the docs chrome — logo, navigation, sidebar, table
of contents — without them.

### Compatibility

**Papervine is Mintlify-compatible.** It reads the same MDX content and the same
`docs.json` navigation file, so an existing Mintlify project renders as-is — no
migration step, no proprietary build, no conversion tool:

```
git clone https://github.com/your-org/your-docs
npx papervine dev ./your-docs
```

That also makes it a practical **GitBook or ReadMe alternative** if you'd rather keep
your docs as MDX files in your own repo than in someone's CMS. Your content stays
files you own.

Papervine is an independent project and is not affiliated with Mintlify, GitBook, or
ReadMe.

### Troubleshooting

**`no docs.json in <dir>`** — you're not in a docs repo root. Pass the folder that
contains `docs.json`, e.g. `papervine dev ./docs`.

**`port 3000 is already in use`** — pass `--port`, or drop the flag and let the CLI
pick the next free port.

**A component renders as plain text** — an unknown component degrades to its children
rather than failing the page. Check the spelling against the supported component set.

**Utility classes in your own MDX don't apply** — the stylesheet is compiled when this
package is built, so arbitrary Tailwind classes written in your MDX aren't in it. Use
the documented components and `docs.json` theming instead.

### Trust

`papervine dev` compiles and executes the repo's MDX, which is arbitrary JSX and
JavaScript. That's expected for your own docs, but it means you should only run it on
docs repos you trust — the same care you'd take before `npm install` in a project.

### Roadmap

`dev` is the whole surface today. Next up: `broken-links`, `validate`,
`openapi-check`, `new`, and `build` (static export).

### Get started

Docs at [papervine.io](https://docs.papervine.io) · source and issues at
[github.com/papervine/cli](https://github.com/papervine/cli).

MIT licensed.
