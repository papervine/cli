#!/usr/bin/env node
/**
 * Clean-room test for the published `papervine` package.
 *
 * Every interesting way the CLI can break is a "works in the monorepo, breaks once
 * published" bug, and none of the other suites can see them, because they all run
 * with the workspace's hoisted node_modules in scope. Real examples this guards:
 *
 *  - `@papervine/renderer` imported `shiki` without declaring it. Fine in the
 *    monorepo (hoisted from the root), unresolvable from a standalone install.
 *  - The CLI shipped `.tsx` + a tsconfig with no `typescript` dependency, so the
 *    first `npx` run tried to install a compiler into the npx cache.
 *  - `apps/cli/tailwind.config.ts` globs `../../packages/renderer/**`, a path that
 *    does not exist inside the tarball.
 *  - `scripts/prepack.mjs` prunes the traced output; an over-eager prune only shows
 *    up when the pruned tree actually has to serve a page.
 *
 * So: pack the real tarball, install it into a temp directory *outside* this repo,
 * and serve a real docs repo through the installed binary. If it 200s here, it 200s
 * for `npx papervine`.
 *
 * Slow (packing runs a full `next build`), so it is deliberately not part of
 * `npm test`. Run with `node tests/cli-package.mjs`.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO = process.cwd();
const PORT = Number(process.env.CLI_PKG_PORT ?? 4181);
// 127.0.0.1, not localhost: on some runners localhost resolves to IPv6 ::1 first
// while the server listens on IPv4, so requests never connect.
const BASE = `http://127.0.0.1:${PORT}`;
// The docs repo we serve: Papervine's own docs, which is also the crawl fixture.
// Overridable because this same file is mirrored into the public `papervine/cli` repo
// (scripts/mirror-cli.mjs), which has no `docs/` — it points this at examples/starter.
const DOCS = path.resolve(REPO, process.env.CLI_PKG_DOCS ?? "docs");

const log = (m) => console.log(m);
const failures = [];

// Requests must be answered by the *installed* package, so the sandbox lives in the
// OS temp dir — not under the repo, where node's resolver would walk up and find the
// workspace's node_modules, hiding exactly the bugs this test exists to catch.
const SANDBOX = mkdtempSync(path.join(realpathSync(os.tmpdir()), "papervine-cleanroom-"));

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.join(" ")}\` exited ${res.status}\n${res.stdout ?? ""}${res.stderr ?? ""}`,
    );
  }
  return res.stdout.trim();
}

async function waitForReady(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + "/", { signal: AbortSignal.timeout(10_000) });
      if (res.status === 200) return Date.now() - start;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("installed papervine did not become ready in time");
}

/**
 * Every page slug in a `docs.json` navigation tree. Derived rather than hardcoded so
 * this test works against any docs repo — which it has to, since the same file is
 * mirrored into the public repo and run against a different one.
 */
function navSlugs(docsJson) {
  const slugs = new Set();
  (function walk(node) {
    if (typeof node === "string") return slugs.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const key of ["tabs", "groups", "pages", "navigation", "anchors"]) {
        if (node[key]) walk(node[key]);
      }
    }
  })(docsJson.navigation ?? docsJson);
  return [...slugs];
}

/** The first static asset under `dir`, as the root-relative URL the docs would use. */
function findAsset(dir) {
  const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|pdf|woff2?)$/i;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (ASSET_RE.test(entry.name)) {
        return "/" + path.relative(dir, full).split(path.sep).join("/");
      }
    }
    return null;
  };
  return walk(dir);
}

async function run() {
  log(`▶ clean room: ${SANDBOX}`);

  // 1. Pack the one published package. This runs its `prepack`, i.e. the real
  //    `next build` + prune — so what we install is byte-for-byte what npm would ship.
  //    (`@papervine/renderer` isn't packed because it isn't published: the CLI ships
  //    prebuilt, so the renderer is compiled in rather than installed. That's exactly
  //    why this test has to exercise the *built* tarball — an undeclared renderer
  //    dependency now shows up as a missing module inside the bundle, not as a failed
  //    install.)
  log("▶ packing papervine (runs prepack → next build)");
  sh("npm", ["pack", "--workspace", "papervine", "--pack-destination", SANDBOX], { cwd: REPO });

  const tarballs = readdirSync(SANDBOX).filter((f) => f.endsWith(".tgz"));
  const cliTarball = tarballs.find((f) => f.startsWith("papervine-"));
  if (!cliTarball) throw new Error(`no papervine tarball in ${SANDBOX}: ${tarballs.join(", ")}`);
  log(`  ✓ packed ${tarballs.join(", ")}`);

  // 2. Audit the tarball's contents before trusting it. The CLI is built inside a
  //    monorepo whose root *is* the control plane, and the build has already been
  //    caught reaching over that line: Turbopack's project root resolves to the
  //    monorepo root, so the CLI silently compiled the web app's
  //    `src/instrumentation.ts` — and with it `sentry.server.config.ts` and its
  //    hardcoded production DSN — into a public tarball. Fixed by
  //    `apps/cli/src/instrumentation.ts`; guarded here, because the next conventional
  //    file Next decides to resolve from the root would leak the same way.
  const listing = sh("tar", ["tzf", path.join(SANDBOX, cliTarball)]).split("\n");
  const controlPlane = listing.filter((f) =>
    /better-auth|drizzle|aws-sdk|pusher|modelcontextprotocol|trigger\.dev|@sentry|@tiptap|ai-sdk|resend|\/stripe\//i.test(
      f,
    ),
  );
  if (controlPlane.length) {
    failures.push(
      `control-plane code in the tarball (SPEC §10.6 boundary): ${controlPlane.slice(0, 5).join(", ")}`,
    );
  }
  const suspicious = listing.filter((f) => /\.env|_private|sentry\.|\.git\//i.test(f));
  if (suspicious.length) {
    failures.push(`unexpected files in the tarball: ${suspicious.slice(0, 5).join(", ")}`);
  }
  // A Sentry DSN is the specific secret this build has leaked before, but any
  // ingest URL in a published artifact is wrong — grep the extracted tree, since
  // the filename check above can't see a DSN inlined into a bundled chunk.
  const extracted = path.join(SANDBOX, "extracted");
  sh("mkdir", ["-p", extracted]);
  sh("tar", ["xzf", path.join(SANDBOX, cliTarball), "-C", extracted]);
  const dsnHits = spawnSync("grep", ["-rlE", "ingest\\.[a-z0-9.]*sentry\\.io", extracted], {
    encoding: "utf8",
  }).stdout.trim();
  if (dsnHits) {
    failures.push(`Sentry DSN leaked into the tarball: ${dsnHits.split("\n").slice(0, 3).join(", ")}`);
  }
  log(`  ${controlPlane.length || suspicious.length || dsnHits ? "✗" : "✓"} tarball audit (${listing.length} files)`);

  // 3. Install it as a real consumer would.
  const consumer = path.join(SANDBOX, "consumer");
  sh("mkdir", ["-p", consumer]);
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "cleanroom-consumer", version: "1.0.0", private: true }, null, 2),
  );
  log("▶ installing the tarball into the clean room");
  sh("npm", ["install", "--no-audit", "--no-fund", path.join(SANDBOX, cliTarball)], {
    cwd: consumer,
  });

  // A published CLI must not drag the toolchain along. This is the §10.6 packaging
  // boundary, asserted against a real install rather than a `pack --dry-run` listing.
  const installed = readdirSync(path.join(consumer, "node_modules"));
  const forbidden = installed.filter((d) =>
    /^(typescript|tailwindcss|postcss|autoprefixer|better-auth|drizzle-orm|postgres|pusher|stripe)$/.test(
      d,
    ),
  );
  if (forbidden.length) {
    failures.push(`installed unwanted top-level deps: ${forbidden.join(", ")}`);
  }
  log(`  ✓ installed (${installed.length} top-level entries in node_modules)`);

  // 4. Serve a real docs repo through the installed binary.
  const bin = path.join(consumer, "node_modules", ".bin", "papervine");
  log(`▶ serving ${DOCS} via the installed binary on :${PORT}`);
  const server = spawn(bin, ["dev", DOCS, "-p", String(PORT)], {
    cwd: consumer,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  try {
    const bootMs = await waitForReady();
    log(`  ✓ ready in ${bootMs}ms (prebuilt: no compile step)`);

    // Every page the docs repo's nav declares must render. Cheaper than a full crawl
    // (that's tests/crawl.mjs) but it does prove the whole nav tree survived packing,
    // including nested groups, rather than just the one page someone remembered to list.
    const docsConfig = JSON.parse(readFileSync(path.join(DOCS, "docs.json"), "utf8"));
    const slugs = navSlugs(docsConfig);
    if (!slugs.length) failures.push(`no pages found in ${DOCS}/docs.json navigation`);

    let pageFailures = 0;
    for (const slug of ["", ...slugs]) {
      const url = `${BASE}/${slug === "index" ? "" : slug}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (res.status !== 200) {
          failures.push(`[/${slug}] expected 200, got ${res.status}`);
          pageFailures++;
        }
      } catch (e) {
        failures.push(`[/${slug}] request failed: ${e.message}`);
        pageFailures++;
      }
    }
    log(
      `  ${pageFailures ? "✗" : "✓"} ${slugs.length + 1} pages from docs.json render ` +
        `(${pageFailures} failed)`,
    );

    // The prebuilt stylesheet and client chunks have to be in the tarball and served.
    // Missing them looks like a broken renderer, not a missing file — see prepack.
    const before = failures.length;
    const home = await (await fetch(BASE + "/")).text();
    const css = home.match(/\/_next\/static\/[^"]+\.css/)?.[0];
    if (!css) {
      failures.push("no stylesheet linked from / — prepack did not ship build/static");
    } else {
      const res = await fetch(BASE + css);
      const sheet = await res.text();
      if (res.status !== 200) failures.push(`stylesheet ${css} returned ${res.status}`);
      // Proves Tailwind compiled with the renderer's sources in scope: a class only
      // reachable through a renderer component, not through apps/cli/src.
      else if (!sheet.includes("--tw-")) failures.push(`stylesheet ${css} is not Tailwind output`);
    }
    log(`  ${failures.length === before ? "✓" : "✗"} /_next/static stylesheet served`);

    // Docs-repo assets are served out of PAPERVINE_CONTENT by the dbasset route via
    // middleware — both have to survive packing. The asset is discovered rather than
    // hardcoded, since the docs repo under test varies (this file is mirrored to a repo
    // whose example site has no favicon).
    const assetBefore = failures.length;
    const asset = findAsset(DOCS);
    if (!asset) {
      failures.push(`no static asset found under ${DOCS} — cannot verify asset serving`);
    } else {
      const res = await fetch(BASE + asset);
      if (res.status !== 200) {
        failures.push(`docs-repo asset ${asset} returned ${res.status} — dbasset/middleware`);
      }
    }
    log(`  ${failures.length === assetBefore ? "✓" : "✗"} docs-repo asset served (${asset ?? "none"})`);

    // A missing page must 404, not 500.
    const nfBefore = failures.length;
    const nf = await fetch(BASE + "/definitely-not-a-page");
    if (nf.status !== 404) failures.push(`missing page returned ${nf.status}, expected 404`);
    log(`  ${failures.length === nfBefore ? "✓" : "✗"} missing page 404s`);

    // Search: an in-memory Orama index over the served folder, so it has to work from the
    // packaged bundle with no backend. The query is derived from the nav rather than
    // hardcoded, since this runs against a different docs repo in the mirrored repo.
    const searchBefore = failures.length;
    const term = (slugs.find((s) => s !== "index") ?? "").split("/").pop() ?? "";
    if (!term) {
      failures.push("could not derive a search term from the nav");
    } else {
      const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(term)}`);
      if (res.status !== 200) {
        failures.push(`/api/search returned ${res.status}`);
      } else {
        const body = await res.json();
        if (!Array.isArray(body.results)) {
          failures.push(`/api/search returned no results array: ${JSON.stringify(body).slice(0, 80)}`);
        } else if (!body.results.length) {
          failures.push(`/api/search found nothing for "${term}", which is a page in the nav`);
        } else if (!body.results[0].href) {
          failures.push(`/api/search hit has no href: ${JSON.stringify(body.results[0]).slice(0, 80)}`);
        }
      }
    }
    log(`  ${failures.length === searchBefore ? "✓" : "✗"} search returns hits (q="${term}")`);
  } catch (e) {
    // Boot failures are the interesting ones and the server's own output is the only
    // place the reason appears, so re-throw with it attached rather than losing it.
    throw new Error(`${e.message}\n--- server output ---\n${serverLog}`);
  } finally {
    server.kill("SIGTERM");
  }

  if (failures.length) log(`\n--- server output ---\n${serverLog}`);
}

// The guard rails: refuse to run against a missing docs repo, and always clean up.
try {
  if (!readdirSync(DOCS).includes("docs.json")) {
    throw new Error(`${DOCS} has no docs.json — nothing to serve`);
  }
  await run();
} catch (e) {
  failures.push(e.message);
} finally {
  rmSync(SANDBOX, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n✗ clean-room package test failed — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ clean-room package test passed");