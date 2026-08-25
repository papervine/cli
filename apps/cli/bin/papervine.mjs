#!/usr/bin/env node
// Papervine CLI — `papervine dev` previews any docs repo locally: run it in a
// folder of MDX + docs.json and it serves that folder with the Papervine renderer
// (SPEC §10.6). A local dev tool only — it ships the renderer, never the hosted
// control plane.
//
// The renderer is *prebuilt*: `npm publish` runs `scripts/prepack.mjs`, which
// builds the Next app and normalizes it into `server/`. So this script starts a
// compiled server rather than a toolchain — no TypeScript, no Tailwind, no webpack
// on the user's machine, and no ~40s first-run compile. The tradeoff is that there
// is no HMR: an edited MDX file shows up on the next request, because every page
// is force-dynamic and re-reads content from disk.
//
// Not to be confused with the repo-root `bin/papervine.mjs`, which is the
// *contributor* tool — it runs the full monorepo app (control plane included)
// against a content dir. This one is what `npx papervine` executes.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { Socket } from "node:net";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import path from "node:path";

import { parseServerArgs, parseNewArgs, validateContentDir, validateNewTarget } from "./args.mjs";
import { bold, brand, brandLight, dim, red, rows, yellow } from "./style.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRY = path.join(PKG_ROOT, "server", "server.js");

// A local preview binds loopback, not every interface — a docs previewer has no business being
// reachable from the LAN by default. `PAPERVINE_HOST` overrides it for the container case,
// where the port has to be reachable from the host.
//
// Deliberately NOT `HOSTNAME`, which is what this used to read. `HOSTNAME` is set by the
// environment for unrelated reasons — Docker sets it to the container id, Kubernetes to the pod
// name, and interactive shells export it — so the bind address silently became whatever that
// was. In a container the server bound the container's own hostname, which meant
// `curl 127.0.0.1:3000` inside it got connection-refused while the CLI cheerfully printed
// `http://<container-id>:3000` and claimed to be ready. A variable that ubiquitous has no
// business controlling network exposure.
/**
 * The bind address, in precedence order: `--host`, then `PAPERVINE_HOST`, then the mode's
 * default — loopback for `dev`, every interface for `serve`.
 *
 * Deliberately NOT `HOSTNAME`, which is what this used to read. `HOSTNAME` is set by the
 * environment for unrelated reasons — Docker sets it to the container id, Kubernetes to the pod
 * name, and interactive shells export it — so the bind address silently became whatever that
 * was. In a container the server bound the container's own hostname, which meant
 * `curl 127.0.0.1:3000` inside it got connection-refused while the CLI cheerfully printed
 * `http://<container-id>:3000` and claimed to be ready. A variable that ubiquitous has no
 * business controlling network exposure.
 */
function resolveHost(plan, serving) {
  if (plan?.host) return plan.host;
  if (process.env.PAPERVINE_HOST) return process.env.PAPERVINE_HOST;
  return serving ? "0.0.0.0" : "127.0.0.1";
}

/**
 * In a source checkout only: is the prebuilt server older than the sources it was built from?
 *
 * `dev` serves a *prebuilt* app, so editing the renderer changes nothing until it is rebuilt —
 * and the symptom is silence, not an error. That has now cost two debugging sessions (a nav fix
 * and a theme change, both "I changed it and see no difference"), so it gets a line rather than
 * a lesson. A published package has no sources beside it and never reaches this.
 *
 * Returns the newest source mtime when the build is behind, else null.
 */
function staleBuildSince() {
  const roots = [
    path.join(PKG_ROOT, "..", "..", "packages", "renderer"),
    path.join(PKG_ROOT, "src"),
  ].filter((d) => existsSync(d));
  if (roots.length === 0) return null; // installed package — nothing to be stale against

  let built;
  try {
    built = statSync(SERVER_ENTRY).mtimeMs;
  } catch {
    return null;
  }

  let newest = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|css|mjs|js)$/.test(e.name)) {
        try {
          newest = Math.max(newest, statSync(full).mtimeMs);
        } catch {
          /* raced with an edit; ignore */
        }
      }
    }
  };
  for (const r of roots) walk(r);

  return newest > built ? newest : null;
}

function fail(msg) {
  console.error(`${red("papervine:")} ${msg}`);
  process.exit(1);
}

/** The package's own version, for the help header and `--version`. */
function version() {
  try {
    return JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "";
  }
}

/**
 * The help screen.
 *
 * Deliberately *not* grouped into categories yet. Category headers earn their keep at a dozen
 * commands; over two they'd be more chrome than content. The roadmap commands
 * (`broken-links`, `validate`, `openapi-check`, `build`) are what turn this into
 * Preview / Quality / Build groups, and `rows()` already takes the shape for it.
 */
function printHelp() {
  const v = version();
  const out = [];

  out.push(`${bold("Papervine CLI")}${v ? ` ${dim(`v${v}`)}` : ""}`);
  out.push("");
  out.push(`${dim("Serve a docs site of MDX +")} ${brand("docs.json")} ${dim("— locally or in production.")}`);
  out.push("");

  out.push(bold("EXAMPLES"));
  out.push(
    rows([
      ["papervine new my-docs", "Create a documentation site in ./my-docs"],
      ["papervine dev", "Preview the docs in the current directory"],
      ["papervine dev ./docs", "Preview a subfolder"],
      ["papervine dev -p 4000", "Preview on a specific port"],
      ["papervine serve ./docs", "Serve it for real, behind your own proxy"],
    ]),
  );
  out.push("");

  out.push(bold("COMMANDS"));
  out.push(
    rows([
      ["new [dir]", "Create a documentation site (default: .)"],
      ["dev [dir]", "Serve your site locally while you write (default: .)"],
      ["serve [dir]", "Serve your site for real — binds every interface (default: .)"],
    ]),
  );
  out.push("");

  out.push(bold("OPTIONS"));
  out.push(
    rows([
      ["-p, --port <port>", "dev/serve — port to serve on (default: 3000)"],
      ["--host <addr>", "dev/serve — bind address (dev: 127.0.0.1, serve: 0.0.0.0)"],
      ["-y, --yes", "dev — create a site if there are no docs, without asking"],
      ["-f, --force", "new — scaffold into a directory that isn't empty"],
      ["-h, --help", "Show this help"],
      ["-v, --version", "Print the version"],
    ]),
  );
  out.push("");

  // Worth saying on the help screen rather than only in the docs: `dev` executes the repo's
  // MDX, which is arbitrary JSX. Someone about to point it at a repo they cloned should see it.
  out.push(
    `${dim("Note:")} ${dim("papervine compiles and runs the repo's MDX, which is arbitrary")}`,
  );
  out.push(`${dim("JSX/JavaScript. Only run it on docs repos you trust.")}`);
  out.push("");
  out.push(`${dim("Docs at")} ${brandLight("https://docs.papervine.io")}`);

  console.log(out.join("\n"));
}

/**
 * Where the scaffold template lives. Published packages carry it at `template/` (copied from
 * examples/starter by prepack); a source checkout has no such copy, so fall back to the
 * monorepo path so `new` is usable while developing the CLI itself.
 */
function templateDir() {
  const packaged = path.join(PKG_ROOT, "template");
  if (existsSync(packaged)) return packaged;
  const fromSource = path.join(PKG_ROOT, "..", "..", "examples", "starter");
  return existsSync(fromSource) ? fromSource : null;
}

/** Copy the template into `dir`, creating it if needed. Returns the file count. */
function scaffold(dir) {
  const template = templateDir();
  if (!template) {
    fail(
      `no scaffold template found\n` +
        `  A published papervine ships one at ${path.join(PKG_ROOT, "template")}.`,
    );
  }
  mkdirSync(dir, { recursive: true });
  // `dereference` for the same reason prepack needs it: npm drops symlinks, so a packaged
  // template is real files, but a source checkout could contain links.
  cpSync(template, dir, { recursive: true, dereference: true });

  let count = 0;
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(current, entry.name));
      else count++;
    }
  })(dir);
  return count;
}

/**
 * Is image optimization available?
 *
 * `sharp` is an *optional* dependency: it carries a native binary, so it is the one thing that
 * cannot be vendored into a platform-agnostic tarball (a Mac-built package silently served
 * full-size images on Linux — 220KB where 1.5KB would do, with no warning, because Next quietly
 * falls back to the original when sharp is missing). npm installs the right binary per platform;
 * when that is not possible the CLI still works, and this is what stops the difference being
 * invisible.
 *
 * Resolved from the server directory because that is where Next resolves it from at runtime.
 */
function imageOptimizationAvailable() {
  try {
    createRequire(path.join(PKG_ROOT, "server", "server.js")).resolve("sharp");
    return true;
  } catch {
    return false;
  }
}

/**
 * Load `.env.local` / `.env` from the docs project, the way every other Node tool does.
 *
 * Without this the only way to configure anything — an API key for the assistant, a model, a
 * local inference URL — was to `export` it in the shell, because the server is spawned with
 * `cwd` set to the *installed package*, not the user's project. A key sitting in `.env.local`
 * next to `docs.json` did nothing at all, silently: the assistant just never appeared.
 *
 * Two rules, both about not surprising anyone:
 *
 *  - **An exported variable always wins.** `process.loadEnvFile` already refuses to overwrite an
 *    existing value, and the fallback below matches that. So `ANTHROPIC_API_KEY=… papervine dev`
 *    beats whatever is in a file, which is the direction people expect.
 *  - **More specific is loaded first.** Because nothing overwrites, *first* write wins — so the
 *    order is the reverse of what it looks like: `.env.local` before `.env`, and the content
 *    directory before the working directory. Running `papervine dev ./docs` from a repo root
 *    picks up a key in either place, preferring the one nearer the docs.
 */
function loadEnvFiles(contentDir) {
  // `process.loadEnvFile` is Node 20.12+; `engines` allows 20.9, so parse it ourselves when the
  // built-in isn't there rather than silently skipping the file on those versions.
  const load = (file) => {
    if (!existsSync(file)) return;
    if (typeof process.loadEnvFile === "function") {
      try {
        process.loadEnvFile(file);
      } catch {
        // A malformed env file must not stop the preview from starting.
      }
      return;
    }
    try {
      for (const raw of readFileSync(file, "utf8").split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
        if (key in process.env) continue; // never override
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    } catch {
      // Same reasoning: unreadable file, carry on.
    }
  };

  const dirs = [contentDir];
  if (path.resolve(process.cwd()) !== path.resolve(contentDir)) dirs.push(process.cwd());
  for (const dir of dirs) {
    for (const name of [".env.local", ".env"]) load(path.join(dir, name));
  }
}

/** True when we can meaningfully ask the user a question. */
function interactive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Ask a yes/no question. Only call when `interactive()`. */
function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function runNew(argv) {
  let plan;
  try {
    plan = parseNewArgs(argv, process.cwd());
  } catch (err) {
    fail(`${err.message}\n  Run \`papervine --help\`.`);
  }
  if (plan.help) {
    printHelp();
    return;
  }

  const exists = existsSync(plan.dir);
  const problem = validateNewTarget({
    dir: plan.dir,
    exists,
    isDirectory: exists && statSync(plan.dir).isDirectory(),
    entries: exists && statSync(plan.dir).isDirectory() ? readdirSync(plan.dir) : [],
    force: plan.force,
  });
  if (problem) fail(problem);

  const count = scaffold(plan.dir);

  // Show the relative path only when it's actually shorter and readable. `path.relative` to a
  // target outside the tree yields a stack of `../..` that's longer than the absolute path and
  // reads like a bug, so fall back to absolute in that case.
  const rel = path.relative(process.cwd(), plan.dir);
  const here = rel === "";
  const shown = here || rel.startsWith("..") ? plan.dir : rel;

  console.log(`${brand("▲ papervine")} created ${bold(shown)} ${dim(`(${count} files)`)}\n`);
  console.log(bold("Next"));
  if (!here) console.log(`  ${brandLight(`cd ${shown}`)}`);
  console.log(`  ${brandLight("papervine dev")}\n`);
  console.log(dim("Edit docs.json to set the name, colors and navigation."));
}

/**
 * Is anything listening on `port`? Resolves true/false, never rejects.
 *
 * This *connects* rather than trying to bind, which matters more than it looks. A bind
 * probe on `127.0.0.1` does not see a server listening on `::`/`*` — the usual shape for
 * `next dev` — so the probe reports the port free, the server then "binds" it, prints
 * "Ready", and receives no traffic at all, because the pre-existing wildcard listener
 * keeps answering. A success message on a port you don't own is the worst possible
 * failure mode: it sends you off debugging your docs when you're looking at someone
 * else's server. (This repo already knows the IPv4/IPv6 loopback split bites — see the
 * gotcha about tests fetching 127.0.0.1 rather than localhost. This is its other face.)
 *
 * A connection attempt is address-family agnostic: a dual-stack `::` listener accepts an
 * IPv4-mapped connection, so it gets caught. Both loopback addresses are probed for the
 * case where something is bound only to `::1`.
 */
async function isPortFree(port) {
  const canConnect = (address) =>
    new Promise((resolve) => {
      const socket = new Socket();
      const done = (result) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(600);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      // ECONNREFUSED is the clean "nothing is listening". Anything else (EHOSTUNREACH on
      // a host without IPv6, say) also isn't evidence of a listener.
      socket.once("error", () => done(false));
      socket.connect(port, address);
    });

  for (const address of ["127.0.0.1", "::1"]) {
    if (await canConnect(address)) return false;
  }
  return true;
}

/**
 * The first free port at or after `start`. Mirrors what a docs previewer should do
 * on a busy port — move over rather than refuse to start — but only when the port
 * was a default, since an explicit `--port` is a request, not a suggestion.
 */
async function resolvePort(start, explicit) {
  if (explicit) {
    if (await isPortFree(start)) return start;
    fail(`port ${start} is already in use — pass a different \`--port\`.`);
  }
  for (let port = start; port < start + 10; port++) {
    if (await isPortFree(port)) {
      // Say it loudly when we move. Quietly serving somewhere other than where the user
      // is about to look is how "my images are broken" turns out to be "you're reading a
      // different server" — worth a line of noise to prevent.
      if (port !== start) {
        console.log(
          `${yellow("!")} port ${start} is in use — serving on ${bold(String(port))} instead`,
        );
      }
      return port;
    }
  }
  fail(`no free port in ${start}–${start + 9} — pass an explicit \`--port\`.`);
}

/**
 * Run the server. `dev` and `serve` are the same server — the same prebuilt production app, with
 * `NODE_ENV=production` and no dev-mode compile — differing in exactly two defaults:
 *
 *   - **Bind address.** `dev` binds loopback, because a command you run on your laptop has no
 *     business being on the LAN by default. `serve` binds every interface, because being
 *     reachable is the whole point of the word, and making the production command need an
 *     environment variable to do its job is its own kind of footgun. Both print what they bound,
 *     and `--host` / `PAPERVINE_HOST` override either way — pinning `serve` back to loopback is
 *     the right move behind a reverse proxy.
 *   - **The scaffold offer.** `dev` offers to create a starter site when there are no docs;
 *     `serve` just fails, because a production server that invents content is worse than one
 *     that stops.
 *
 * Two names rather than one because the name is the documentation: nobody should have to type
 * `dev` on a box serving real traffic and learn from a README that it isn't a dev server.
 *
 * @param {string[]} argv
 * @param {"dev" | "serve"} mode
 */
async function runServer(argv, mode) {
  const serving = mode === "serve";
  let plan;
  try {
    plan = parseServerArgs(argv, process.cwd());
  } catch (err) {
    fail(`${err.message}\n  Run \`papervine --help\`.`);
  }
  const host = resolveHost(plan, serving);

  if (plan.help) {
    printHelp();
    return;
  }

  const problem = validateContentDir({
    dir: plan.dir,
    exists: existsSync(plan.dir),
    isDirectory: existsSync(plan.dir) && statSync(plan.dir).isDirectory(),
    hasDocsJson: existsSync(path.join(plan.dir, "docs.json")),
    command: mode,
  });
  if (problem) {
    // No docs yet is the one failure worth offering to fix rather than just reporting: someone
    // who typed the obvious command shouldn't have to discover that a second one exists. The
    // offer is gated on a TTY — in CI or a pipe, a prompt waiting on stdin that nobody can
    // answer is worse than the plain error, so those keep today's behaviour exactly.
    // `serve` never scaffolds: inventing content on a box that is meant to be serving real
    // traffic hides the actual problem (wrong path, unmounted volume) behind a site that looks
    // fine and says nothing true.
    const emptyish =
      !serving &&
      !existsSync(path.join(plan.dir, "docs.json")) &&
      (!existsSync(plan.dir) || readdirSync(plan.dir).every((n) => n.startsWith(".")));

    if (emptyish && plan.yes) {
      const count = scaffold(plan.dir);
      console.log(`${brand("▲ papervine")} created a docs site ${dim(`(${count} files)`)}\n`);
    } else if (emptyish && interactive()) {
      console.log(`${yellow("!")} no docs.json in ${bold(plan.dir)}`);
      const yes = await confirm(`  Create a starter docs site here? ${dim("[y/N]")}`);
      if (!yes) {
        console.log(`\n  Nothing created. \`papervine new <dir>\` when you're ready.`);
        process.exit(0);
      }
      const count = scaffold(plan.dir);
      console.log(`${brand("▲ papervine")} created a docs site ${dim(`(${count} files)`)}\n`);
    } else {
      fail(problem);
    }
  }

  // Before anything reads configuration: the assistant's provider check below, and the server's
  // own environment, both depend on what these files set.
  loadEnvFiles(plan.dir);

  if (!existsSync(SERVER_ENTRY)) {
    fail(
      `renderer not built — no server at ${SERVER_ENTRY}\n` +
        `  A published papervine ships this prebuilt. From a source checkout, run\n` +
        `  \`npm run prepack --workspace papervine\` first.`,
    );
  }

  const port = await resolvePort(plan.port, plan.portExplicit);

  console.log(`${brand("▲ papervine")} serving ${bold(plan.dir)}`);
  console.log(`  ${dim("→")} ${brandLight(`http://${host === "0.0.0.0" ? "localhost" : host}:${port}`)}`);
  // Say it out loud. `serve` binding every interface is intended, but "intended" and "understood
  // by the person who typed it" are different things, and this is the line that makes them one.
  console.log(
    host === "0.0.0.0"
      ? `  ${dim(`bound to all interfaces (0.0.0.0:${port}) — reachable from your network`)}\n`
      : `  ${dim(`bound to ${host} only`)}\n`,
  );

  // Worth a line, not a failure: pages render fine either way, but anyone serving this for real
  // should know their images are going out at full size.
  if (!imageOptimizationAvailable()) {
    console.log(
      `${yellow("!")} image optimization unavailable — serving images at original size.\n` +
        `  ${dim("Install the optional dependency with `npm i sharp` in this project.")}\n`,
    );
  }

  // Contributor-only: the sources moved after this server was built, so what you are looking at
  // is not what you just changed.
  if (staleBuildSince()) {
    console.log(
      `${yellow("!")} this server was built before your latest renderer changes — it is serving the old build.\n` +
        `  ${dim("Rebuild with `npm run prepack --workspace papervine`.")}\n`,
    );
  }

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PKG_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      PAPERVINE_CONTENT: plan.dir,
      PORT: String(port),
      // `HOSTNAME` is how Next's standalone server takes its bind address, so it stays that
      // name here — but it's set from our own resolved host (see `resolveHost`), never
      // inherited. That's the whole point: an ambient HOSTNAME from Docker or a shell must not
      // reach the server, and an explicit HOSTNAME in the environment is overridden by this.
      HOSTNAME: host,
      NODE_ENV: "production",
    },
  });

  // Ctrl-C has to be the one thing that always works.
  //
  // Installing a signal handler *replaces* Node's default "terminate now", so this process now
  // lives entirely at the mercy of the child: forward the signal, then wait for `exit`. If the
  // server ever fails to go — a hung request, a shutdown that waits on a live handle, a bug in a
  // dependency — Ctrl-C does nothing at all and pressing it again just re-sends the same signal
  // it is already ignoring. There is no way out but another terminal.
  //
  // So the wait is bounded: forward, and if the child is still alive shortly after, SIGKILL it.
  // A second Ctrl-C skips the wait entirely, which is what a person does when the first appears
  // to have done nothing.
  const GRACE_MS = 2_000;
  let quitting = false;

  const stop = (sig) => () => {
    if (quitting) {
      // Second press: stop asking.
      child.kill("SIGKILL");
      process.exit(130);
    }
    quitting = true;
    child.kill(sig);
    const grace = setTimeout(() => child.kill("SIGKILL"), GRACE_MS);
    // Don't let the grace timer itself hold this process open once the child is gone.
    grace.unref?.();
  };

  process.on("SIGINT", stop("SIGINT"));
  process.on("SIGTERM", stop("SIGTERM"));

  // Propagate how the child ended. `code` is null when it died from a signal, and the shell
  // convention for that is 128 + the signal number — reporting 0 there would tell a script the
  // preview exited cleanly when it was killed.
  const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
  child.on("exit", (code, signal) => process.exit(code ?? SIGNAL_EXIT[signal] ?? 1));
}

const [, , command, ...rest] = process.argv;

if (!command || command === "-h" || command === "--help" || command === "help") {
  printHelp();
} else if (command === "dev") {
  await runServer(rest, "dev");
} else if (command === "serve") {
  await runServer(rest, "serve");
} else if (command === "new") {
  runNew(rest);
} else if (command === "-v" || command === "--version" || command === "version") {
  console.log(version());
} else {
  fail(`unknown command "${command}". Run \`papervine --help\`.`);
}
