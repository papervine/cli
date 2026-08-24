<div align="center">

<img src="https://raw.githubusercontent.com/papervine/cli/main/apps/cli/assets/logo.png" width="120" height="120" alt="Papervine" />

# Papervine

---

**The Mintlify-compatible alternative — open-source MDX documentation.**

Preview your docs locally with the same renderer that serves them in production. Point it at a folder of MDX and a `docs.json`.

[![npm](https://img.shields.io/npm/v/papervine?logo=npm&label=npm&color=7C3AED)](https://www.npmjs.com/package/papervine) [![license](https://img.shields.io/badge/license-MIT-7C3AED)](./LICENSE) [![node](https://img.shields.io/badge/node-%E2%89%A520.9-7C3AED?logo=nodedotjs&logoColor=white)](https://nodejs.org) [![docs](https://img.shields.io/badge/docs-papervine.io-7C3AED)](https://docs.papervine.io)

[Quickstart](#quickstart) · [Commands](#create-a-site) · [What ships](#what-ships-in-this-package) · [Compatibility](#compatibility) · [Docs](https://docs.papervine.io)

<img src="https://raw.githubusercontent.com/papervine/cli/main/apps/cli/assets/screenshot.png" width="900" alt="A docs site rendered by papervine dev — navigation, component gallery and a copyable snippet, in dark mode" />

</div>

### Quickstart

No docs yet? Create a site and preview it:

```
npx papervine@latest new my-docs
cd my-docs
npx papervine@latest dev
```

Already have a folder of MDX and a `docs.json`? Skip straight to previewing it:

```
npx papervine@latest dev ./docs
```

Requires Node 20.9 or higher. The CLI ships a **prebuilt** renderer, so there's no build
toolchain to install and no first-run compile — it starts serving in about a second.

### Installation

Running through `npx` needs no install. To have it permanently:

```
npm i -g papervine
```

### Create a site

#### `papervine new [dir]`

Create a docs site in `[dir]`, defaulting to the current directory. The starter it writes
is a complete, working site — `docs.json`, a few pages, a component gallery, and an OpenAPI
example — so you can preview it immediately and delete what you don't want.

```
papervine new my-docs
```

**Options**

| Flag           | Description                                        |
| -------------- | -------------------------------------------------- |
| `-f, --force`  | Scaffold into a directory that isn't empty         |
| `-h, --help`   | Show help                                          |

A directory that isn't empty is refused unless you pass `--force`, since scaffolding writes
files and overwriting your work because of a mistyped path isn't recoverable. Directories
containing only dotfiles (a fresh `git init`, say) count as empty.

The template is bundled in the package, so `new` works offline and always matches the
version of the CLI that wrote it.

### Local preview

#### `papervine dev [dir]`

Serve the docs in `[dir]`, defaulting to the current directory. The directory must
contain a `docs.json` at its root.

```
papervine dev
```

**Options**

| Flag                | Description                                          | Default |
| ------------------- | ---------------------------------------------------- | ------- |
| `-p, --port <port>` | Port to serve on                                     | `3000`  |
| `-y, --yes`         | Create a starter site if there are no docs, no prompt | —       |
| `-h, --help`        | Show help                                            | —       |

**Nothing to preview yet?** Run in an empty folder and it offers to create a site rather
than just failing:

```
$ papervine dev
! no docs.json in /Users/you/my-docs
  Create a starter docs site here? [y/N]
```

The prompt only appears in an interactive terminal. In CI or a pipe it prints the error and
exits non-zero as before, because a prompt nobody can answer is worse than a clear failure.
Use `--yes` to scaffold without being asked.

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
`PAPERVINE_HOST=0.0.0.0` to reach it from outside the machine, e.g. from a container host.
(`PAPERVINE_HOST`, not `HOSTNAME` — Docker and Kubernetes set `HOSTNAME` for their own
reasons, and that shouldn't decide what your preview is reachable from.)

### Images

Images are optimized on the fly — resized to what the page needs and served as WebP where the
browser accepts it. This is done by [`sharp`](https://sharp.pixelplumbing.com), an **optional
dependency**: it contains a compiled binary specific to your OS and CPU, so npm installs the
right one for your machine. Nothing to configure.

If it can't be installed, the CLI still runs, serves images at their original size, and tells
you at startup:

```
! image optimization unavailable — serving images at original size.
  Install the optional dependency with `npm i sharp` in this project.
```

### Output

`papervine --help` and `papervine --version` print the command surface and the installed
version. Help and status output is colourised at a terminal and plain everywhere else, so
piping or redirecting gives you clean text rather than escape codes:

| Variable      | Effect                                                     |
| ------------- | ---------------------------------------------------------- |
| `NO_COLOR`    | Set to anything non-empty to disable colour entirely        |
| `FORCE_COLOR` | Set to keep colour through a pipe; `0` disables it          |

### What ships in this package

Just the renderer: MDX compilation, `docs.json` parsing, navigation, the component
set, and OpenAPI endpoint pages — the same engine that serves hosted Papervine sites,
compiled in.

It carries **none** of the hosted product: no authentication, database, object
storage, realtime, or AI assistant. Those are services of a hosted deployment, not
things a local previewer needs, so they are absent from the package rather than
disabled at runtime.

The renderer has no runtime dependencies — it is compiled in. The one thing npm installs
alongside it is [`sharp`](#images), an optional dependency for image optimization.

**Search is included**, and works with no service behind it: `⌘K` searches your docs from an
in-memory index the CLI builds over your pages on the first query, then reuses until you edit
a file.

The "Ask AI" assistant is a hosted feature and is not in the package, so a local preview
shows the docs chrome — logo, navigation, sidebar, table of contents, search — without it.

### Compatibility

**Papervine is Mintlify-compatible.** It reads the same MDX content and the same
`docs.json` navigation file, so an existing Mintlify project runs with no migration step,
no proprietary build and no conversion tool:

```
git clone https://github.com/your-org/your-docs
npx papervine dev ./your-docs
```

One gap worth knowing before you point it at a large repo: **shared snippets aren't resolved
yet.** A page that imports from `/snippets/` renders an inline notice where the snippet
should be, rather than the snippet's content. The rest of the page renders normally.

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

`papervine dev` **compiles** the repo's MDX on your machine but does not *execute* the
repo's code there. Expressions, components you define, and hooks all run in your
**browser**; the server renders only Markdown, built-in components and literal values.

So a docs page can't read your environment variables, touch your filesystem, or run
commands — there's no server-side step where its code runs. Imports outside `/snippets/`
and dynamic `import()` are refused entirely.

It's still someone else's JavaScript in your browser on the preview's origin, which is
the trust you extend to any site you visit — so use normal judgement with an unfamiliar
repo. But previewing one no longer hands it your machine.

The previewer is narrow by construction: it binds loopback, serves only asset file types
from your content directory, and refuses remote image URLs.

### Roadmap

`new` and `dev` are the surface today. Next up: `broken-links`, `validate`,
`openapi-check`, and `build` (static export).

### Get started

Docs at [docs.papervine.io](https://docs.papervine.io) · source and issues at
[github.com/papervine/cli](https://github.com/papervine/cli).

MIT licensed.
