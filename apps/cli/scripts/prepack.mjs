#!/usr/bin/env node
// Build the CLI's renderer and normalize the output into `server/` — the single
// directory the published tarball ships (see `files` in package.json).
//
// Why this script exists rather than a `next build && cp` one-liner:
//
//  1. `output: "standalone"` lays its output out *relative to the tracing root*,
//     which for a workspace app is the monorepo root — so the server entry lands at
//     `build/standalone/apps/cli/server.js`, not `build/standalone/server.js`. The
//     nesting depends on where the app sits in the monorepo, so `bin/papervine.mjs`
//     would have to guess at it. We flatten it once, here, and the bin script gets a
//     stable `server/server.js` forever.
//  2. Standalone deliberately does **not** copy `build/static` (it assumes a CDN
//     serves it). Skipping that copy yields a site with no CSS and no client JS —
//     which looks like a broken renderer, not a missing file.
//
// Runs from npm's `prepack`, so `npm pack` and `npm publish` both get it for free.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(APP_DIR, "build");
const STANDALONE = path.join(DIST, "standalone");
const OUT = path.join(APP_DIR, "server");

function fail(msg) {
  console.error(`\x1b[31mprepack:\x1b[0m ${msg}`);
  process.exit(1);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: APP_DIR, stdio: "inherit" });
  if (res.status !== 0) fail(`\`${cmd} ${args.join(" ")}\` exited ${res.status}`);
}

// A fresh build every time: a stale `server/` silently ships last release's renderer.
rmSync(DIST, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });

// Resolve through Node so it works whether `next` is hoisted to the workspace root
// or installed beside this app.
let nextBin;
try {
  nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
} catch {
  fail("could not resolve `next` — run `npm install` at the monorepo root first.");
}

run(process.execPath, [nextBin, "build"]);

if (!existsSync(STANDALONE)) {
  fail(`no standalone output at ${STANDALONE} — is \`output: "standalone"\` still set?`);
}

// Find `server.js`. It's at the standalone root for a non-workspace app and nested
// under the app's path-from-tracing-root for a workspace one; resolve it rather than
// hardcoding either shape, so moving this app in the monorepo can't break packaging.
const appRel = path.relative(path.join(APP_DIR, "..", ".."), APP_DIR);
const candidates = [path.join(STANDALONE, appRel), STANDALONE];
const serverRoot = candidates.find((dir) => existsSync(path.join(dir, "server.js")));
if (!serverRoot) {
  fail(`could not find server.js under ${STANDALONE} (looked in: ${candidates.join(", ")})`);
}

mkdirSync(OUT, { recursive: true });

// `dereference` is load-bearing, not a detail. Turbopack gives every
// `serverExternalPackages` entry a content-hashed alias inside the dist dir
// (`build/node_modules/@mintlify/mdx-<hash>`) and makes it a *symlink* back to the
// real package. `npm pack` drops symlinks, so a symlinked tree runs fine from a
// source checkout and then 500s the moment it is installed from a tarball —
// "Failed to load external module @mintlify/mdx-<hash>" — which is invisible in
// every test that doesn't install the tarball. Copy real files instead.
const COPY = { recursive: true, dereference: true };

// The traced node_modules sits at the standalone *root* even when server.js is
// nested, so the two halves are copied separately and land flat in `server/`.
const tracedModules = path.join(STANDALONE, "node_modules");
if (existsSync(tracedModules)) {
  cpSync(tracedModules, path.join(OUT, "node_modules"), COPY);
}
cpSync(serverRoot, OUT, {
  ...COPY,
  // Only when serverRoot *is* the standalone root — don't re-copy what we just did.
  filter: (src) => src !== tracedModules && !src.startsWith(tracedModules + path.sep),
});

// The static assets standalone leaves behind. `build/static` is served at
// `/_next/static`, which the server resolves as `<distDir>/static` next to server.js.
cpSync(path.join(DIST, "static"), path.join(OUT, "build", "static"), COPY);

// Drop the app's own sources, which the over-trace dragged in (see the note in
// next.config.mjs). They're dead weight: the app is already compiled into
// `build/server`, and nothing reads the TS/Tailwind config to *serve* a compiled app.
//
// Deliberately limited to our own files — `node_modules` is left exactly as traced.
// Pruning it looks tempting (`typescript` alone is 19MB) and is a trap: `@mintlify/mdx`
// imports `typescript` at runtime for its twoslash plugin, so dropping it installs
// cleanly and then 500s every page. The tracer knows what the runtime needs better
// than a size heuristic does.
// (`README.md`/`LICENSE` get traced in too and are already shipped at the package root —
// `server/` copies are just duplicates. `server/package.json` is NOT prunable: standalone
// generates it, and the server needs it to resolve as ESM.)
const PRUNE = [
  "src",
  "bin",
  "scripts",
  "tsconfig.json",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "README.md",
  "LICENSE",
];
for (const rel of PRUNE) {
  rmSync(path.join(OUT, rel), { recursive: true, force: true });
}

const publicDir = path.join(APP_DIR, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, path.join(OUT, "public"), COPY);
}

if (!existsSync(path.join(OUT, "server.js"))) {
  fail(`normalization failed — no server.js in ${OUT}`);
}

// Assert what the `dereference` note above explains: not one symlink may remain.
// `npm pack` silently drops them, so a single surviving link ships a tarball that
// installs cleanly and then 500s on the first request. Catching it here names the
// offending path; catching it downstream only says "failed to load external module".
const links = [];
(function findLinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) links.push(path.relative(OUT, full));
    else if (entry.isDirectory()) findLinks(full);
  }
})(OUT);
if (links.length) {
  fail(
    `${links.length} symlink(s) survived into ${path.relative(APP_DIR, OUT)}/ — ` +
      `npm pack would drop these:\n  ${links.slice(0, 10).join("\n  ")}`,
  );
}

console.log(`\x1b[32mprepack:\x1b[0m renderer built into ${path.relative(APP_DIR, OUT)}/`);
