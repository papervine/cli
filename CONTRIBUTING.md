# Contributing

Thanks for being here. Contributions are welcome, and there's one unusual thing about
how they land that's worth knowing before you spend time on a change.

## How this repository works

Papervine is developed in a private monorepo, because the CLI and the renderer share
code with a hosted product that isn't open source. This repository is a **generated
mirror** of the open-source half: the `papervine` CLI and the render engine it's built
from, published under MIT.

The practical consequence:

> **Pull requests are reviewed here, but merged upstream.** Nobody clicks "Merge" on this
> repository — a merge here would be reverted by the next sync. Instead, an accepted PR is
> applied to the monorepo, and the next sync carries it back out to this repo.

**Your commit authorship is preserved.** When your change is applied upstream it keeps you
as the author, so the commit that lands here is credited to you and counts toward your
GitHub contribution graph. When we close your PR we'll link the commit.

We know a closed PR reads worse than a merged one. It's the honest trade for keeping the
renderer shared with the hosted product, and it's the thing we'd change first if
contributions become regular.

## Making a change

```bash
git clone https://github.com/papervine/cli
cd cli
npm install
```

Everything runs without any services:

```bash
npm run typecheck      # tsc --noEmit
npm run test:unit      # vitest — the renderer's pure logic
npm run test:cli       # packs the real tarball, installs it, serves examples/starter
```

To preview a docs site while you work:

```bash
npm run dev -- examples/starter     # or any folder with a docs.json
```

CI runs the same three commands on your PR, so a green run locally means a green run
there.

## What makes a good PR

- **A test at the lowest layer that catches the regression.** Pure logic gets a unit test
  in `tests/unit/`; anything about what actually ships gets covered by `npm run test:cli`.
- **A bug fix starts with a failing test.** Write the reproduction first, then fix it.
- **Match the surrounding style** — comment density, naming, and idiom. Comments explain
  *why*, not *what*.
- **One concern per PR.** It makes review, and the upstream port, much faster.

## Things to know about the code

- **Never let one unsupported feature break a page.** Unknown MDX components degrade to
  their children; a compile failure renders an inline notice. A page that 500s is a bug in
  itself, separate from whatever caused it.
- **`docs.json` handling is lenient on purpose.** An unexpected field warns and passes
  through — it must never fail the site. Compatibility is the point.
- **The CLI ships prebuilt.** `npm publish` compiles the app and packs the result, so the
  published package has no runtime dependencies and no build step on the user's machine.
  See `apps/cli/scripts/prepack.mjs`, which has some hard-won notes about why it does what
  it does.

## Reporting bugs

For a rendering bug, the most useful report is a **minimal docs folder** that reproduces
it — a `docs.json` plus the smallest page that goes wrong. That usually becomes the
regression test directly.

## Security

Please don't open a public issue for a security problem. Email
**security@papervine.io** instead.

## License

By contributing you agree that your contribution is licensed under the MIT License, the
same as the rest of this repository.
