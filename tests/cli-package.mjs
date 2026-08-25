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
  existsSync,
  mkdirSync,
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

/**
 * Poll a server's home page until it answers 200.
 *
 * `base` comes first because there is now more than one server to wait for (`dev` and `serve`),
 * and the previous signature took only a timeout — so passing a *port* to it silently became a
 * 4-second timeout against the other server's URL, and reported "never became ready" while the
 * log showed the server ready. An argument that plausibly type-checks as another is worth
 * removing the ambiguity from.
 */
async function waitForReady(base = BASE, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(base + "/", { signal: AbortSignal.timeout(10_000) });
      if (res.status === 200) return Date.now() - start;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`installed papervine did not become ready in time (${base})`);
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
  // Note `ai-sdk` stays on this list even though the CLI now *ships* the assistant: the SDKs are
  // declared `dependencies` and pruned from the packed tree, so npm delivers them and the tarball
  // must not carry a second copy. "Absent from the tarball" and "absent from the product" are
  // different claims now, and only the first one is what this asserts — the counterpart, that
  // they resolve after a real install, is checked further down.
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
  // A compiled binary in the tarball means it only works on the machine that built it. The
  // vendored `sharp` did exactly that: a Mac-built package silently served 220,526-byte images on
  // Linux where the build platform served 3,124, because Next falls back to the original when
  // sharp cannot load. It is an optionalDependency now, resolved per platform by npm.
  const natives = listing.filter((f) => /\.(node|dylib|so(\.\d+)*|dll)$/i.test(f));
  if (natives.length) {
    failures.push(
      `native binaries in the tarball — it would be platform-locked: ${natives.slice(0, 3).join(", ")}`,
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
  log(
    `  ${controlPlane.length || suspicious.length || dsnHits || natives.length ? "✗" : "✓"} ` +
      `tarball audit (${listing.length} files, platform-agnostic)`,
  );

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

  // sharp is the one thing that cannot be vendored (native binary), so it is declared optional
  // and npm resolves the right build per platform. If it is missing here, image optimization is
  // off — which is legal (the CLI warns and serves originals) but not what a normal install
  // should produce, so the gate treats it as a failure rather than letting it pass unnoticed.
  const sharpBefore = failures.length;
  const sharpDir = path.join(consumer, "node_modules", "sharp");
  if (!existsSync(sharpDir)) {
    failures.push("sharp was not installed — image optimization would be silently unavailable");
  }
  log(`  ${failures.length === sharpBefore ? "✓" : "✗"} sharp resolved for this platform`);


  const bin = path.join(consumer, "node_modules", ".bin", "papervine");

  // 4. Scaffold with the installed binary, then serve what it produced.
  //
  //    This is the only check that can prove `papervine new` works, because the template is
  //    bundled by `prepack` from examples/starter — it doesn't exist in a source checkout's
  //    `apps/cli`, so every other suite would pass while a published `new` had nothing to copy.
  //    Serving the result matters as much as creating it: a scaffold that produces files which
  //    don't render is worse than no scaffold, since the first thing anyone does is run `dev`.
  const scaffoldBefore = failures.length;
  const scaffolded = path.join(SANDBOX, "scaffolded");
  const created = spawnSync(bin, ["new", scaffolded], { encoding: "utf8" });
  if (created.status !== 0) {
    failures.push(`\`papervine new\` exited ${created.status}: ${created.stderr || created.stdout}`);
  } else if (!existsSync(path.join(scaffolded, "docs.json"))) {
    failures.push("`papervine new` produced no docs.json");
  }
  // Refusing a non-empty directory is the guard against overwriting someone's work, so it's
  // worth asserting rather than assuming.
  const refused = spawnSync(bin, ["new", scaffolded], { encoding: "utf8" });
  if (refused.status === 0) {
    failures.push("`papervine new` overwrote a non-empty directory instead of refusing");
  }
  log(`  ${failures.length === scaffoldBefore ? "✓" : "✗"} scaffolds a site, refuses a non-empty dir`);

  // 5. Serve a real docs repo through the installed binary.
  log(`▶ serving ${DOCS} via the installed binary on :${PORT}`);
  const server = spawn(bin, ["dev", DOCS, "-p", String(PORT)], {
    cwd: consumer,
    stdio: ["ignore", "pipe", "pipe"],
    // An ambient HOSTNAME must NOT become the bind address. The CLI used to read it, and
    // Docker sets it to the container id / Kubernetes to the pod name — so in a container the
    // server bound the container hostname, `curl 127.0.0.1` was refused, and it printed
    // `http://<container-id>:3000` while claiming to be ready. The override is `PAPERVINE_HOST`
    // now; this value is unresolvable, so if HOSTNAME ever leaks back in, the bind fails and
    // waitForReady below times out instead of quietly passing.
    env: { ...process.env, HOSTNAME: "papervine-hostname-must-be-ignored.invalid" },
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

    // The dbasset route is reachable DIRECTLY at /dbasset/* — middleware's matcher excludes
    // that prefix, so its asset-extension filter doesn't protect it. Without the route's own
    // allowlist it was an arbitrary-file reader for the previewed folder: someone running
    // `papervine dev .` at a project root served their own `.env` over loopback. These are the
    // three shapes that matter, asserted against the *published* binary because that's the only
    // place the route runs.
    const readBefore = failures.length;
    for (const [probe, why] of [
      ["/dbasset/docs.json", "config file"],
      ["/dbasset/.env", "dotfile secret"],
      ["/dbasset/index.mdx", "page source"],
    ]) {
      const res = await fetch(BASE + probe);
      // 404 (not an asset type) or 403 (outside the root) — anything 2xx is a file read.
      if (res.ok) {
        failures.push(`${probe} returned ${res.status} — dbasset is serving a ${why}`);
      }
    }
    // Traversal above the content root must stay refused.
    const up = await fetch(BASE + "/dbasset/../../../../../../etc/passwd");
    if (up.ok && (await up.text()).includes("root:")) {
      failures.push("dbasset traversal escaped the content root");
    }
    log(`  ${failures.length === readBefore ? "✓" : "✗"} dbasset serves assets only, no traversal`);

    // The assistant ships compiled into the package, and the only thing a user supplies is a
    // key. Unconfigured — which is what this clean room is — the endpoint must exist and refuse
    // with a 503 naming what to set. A 404 would mean the route never shipped, and the Ask
    // Assistant button would silently never appear with no error anywhere to explain why.
    const aiBefore = failures.length;
    const ai = await fetch(BASE + "/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    if (ai.status === 404) {
      failures.push("/api/assistant 404s — the assistant did not ship");
    } else if (ai.status !== 503) {
      failures.push(`/api/assistant returned ${ai.status}, expected 503 when unconfigured`);
    } else {
      const body = await ai.json().catch(() => ({}));
      // The message has to name the missing variable, or "unavailable" is unactionable.
      if (!/API_KEY|AI_BASE_URL|OIDC/i.test(String(body.error ?? ""))) {
        failures.push(`/api/assistant 503 did not say what to configure: ${body.error}`);
      }
    }
    log(`  ${failures.length === aiBefore ? "✓" : "✗"} assistant ships, refuses cleanly without a key`);

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

    // The MCP server (SPEC §8.5). Worth a real JSON-RPC exchange rather than a status check:
    // the SDK's Web-standard transport is *compiled into* the server rather than installed
    // beside it, so "the route responds" and "the protocol works from a tarball" are different
    // claims — and only the second one is what a self-hoster's editor depends on.
    const mcpBefore = failures.length;
    const rpc = async (id, method, params) => {
      const res = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
      });
      return res.ok ? res.json() : { error: `HTTP ${res.status}` };
    };

    const init = await rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "cli-package-test", version: "1.0" },
    });
    if (init?.result?.serverInfo?.name !== "Papervine Docs") {
      failures.push(`MCP initialize did not return serverInfo: ${JSON.stringify(init).slice(0, 200)}`);
    }

    const listed = await rpc(2, "tools/list");
    const toolNames = (listed?.result?.tools ?? []).map((t) => t.name).sort();
    // search_api is conditional on the repo having an OpenAPI reference, so it is not required.
    for (const required of ["list_pages", "read_page", "search_docs"]) {
      if (!toolNames.includes(required)) failures.push(`MCP tools/list is missing ${required}`);
    }

    // A tool call has to return real content, not just a well-formed envelope.
    const called = await rpc(3, "tools/call", {
      name: "search_docs",
      arguments: { query: term },
    });
    const payload = called?.result?.content?.[0]?.text;
    let hits = null;
    try {
      hits = JSON.parse(payload ?? "null");
    } catch {
      /* handled below */
    }
    if (!Array.isArray(hits) || hits.length === 0 || !hits[0]?.href) {
      failures.push(`MCP search_docs returned no usable hits: ${String(payload).slice(0, 200)}`);
    }
    log(
      `  ${failures.length === mcpBefore ? "✓" : "✗"} MCP server: initialize, ${toolNames.length} tools, search_docs returns hits`,
    );
  } catch (e) {
    // Boot failures are the interesting ones and the server's own output is the only
    // place the reason appears, so re-throw with it attached rather than losing it.
    throw new Error(`${e.message}\n--- server output ---\n${serverLog}`);
  } finally {
    server.kill("SIGTERM");
  }

  // 6. `papervine serve` — the command a self-hosted deployment actually runs, so it gets
  // clean-room coverage of its own. Pinned to loopback with `--host` rather than taking its
  // 0.0.0.0 default: this is the flag a reverse-proxy deployment uses, and CI has no business
  // opening a port on every interface. Also re-asserts that an ambient HOSTNAME is ignored,
  // since `serve` is the command most likely to run in a container.
  const servePort = PORT + 1;
  log(`▶ serving via \`papervine serve --host 127.0.0.1\` on :${servePort}`);
  const prodServer = spawn(
    bin,
    ["serve", DOCS, "-p", String(servePort), "--host", "127.0.0.1"],
    {
      cwd: consumer,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOSTNAME: "papervine-hostname-must-be-ignored.invalid" },
    },
  );
  let prodLog = "";
  prodServer.stdout.on("data", (d) => (prodLog += d));
  prodServer.stderr.on("data", (d) => (prodLog += d));

  try {
    const before = failures.length;
    await waitForReady(`http://127.0.0.1:${servePort}`);
    const home = await fetch(`http://127.0.0.1:${servePort}/`);
    if (!home.ok) failures.push(`\`serve\` home page: HTTP ${home.status}`);
    if (!prodLog.includes("bound to 127.0.0.1")) {
      // The line that tells an operator what they exposed. Silence here is how someone ends up
      // unsure whether their docs are on the public internet.
      failures.push("`serve` did not report its bind address");
    }
    log(`  ${failures.length === before ? "✓" : "✗"} \`serve\` boots, answers, and states its bind address`);
  } catch (err) {
    failures.push(`\`serve\` never became ready: ${err.message}`);
  } finally {
    prodServer.kill("SIGTERM");
  }

  // A production server must not invent content. `serve` on an empty directory has to fail,
  // because a site that renders a scaffolded placeholder hides the actual fault — a wrong path
  // or an unmounted volume.
  const emptyDir = path.join(consumer, "empty-docs");
  mkdirSync(emptyDir, { recursive: true });
  const refusedServe = spawnSync(bin, ["serve", emptyDir], { encoding: "utf8" });
  if (refusedServe.status === 0) {
    failures.push("`papervine serve` scaffolded an empty directory instead of failing");
  }
  log(`  ${refusedServe.status === 0 ? "✗" : "✓"} \`serve\` refuses an empty directory`);

  if (failures.length) log(`\n--- server output ---\n${serverLog}${prodLog}`);
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