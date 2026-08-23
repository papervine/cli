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
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { parseDevArgs, validateContentDir } from "./args.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRY = path.join(PKG_ROOT, "server", "server.js");

// A local preview binds loopback, not every interface — a docs previewer has no
// business being reachable from the LAN by default. `HOSTNAME` overrides it for
// the container case, where the port has to be reachable from the host.
const HOST = process.env.HOSTNAME || "127.0.0.1";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function fail(msg) {
  console.error(`${red("papervine:")} ${msg}`);
  process.exit(1);
}

function printHelp() {
  console.log(`papervine — preview a docs repo of MDX + docs.json

Usage:
  papervine dev [dir]        Preview the docs in [dir] (default: current directory)

Options:
  -p, --port <port>       Port to serve on (default: 3000)
  -h, --help              Show this help

Examples:
  papervine dev              # preview ./ (must contain docs.json)
  papervine dev ./docs       # preview ./docs
  papervine dev -p 4000      # preview on port 4000

Note: papervine dev compiles and runs the repo's MDX, which is arbitrary
JSX/JavaScript. Only run it on docs repos you trust.
`);
}

/** Is `port` free on HOST? Resolves true/false, never rejects. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
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
    if (await isPortFree(port)) return port;
  }
  fail(`no free port in ${start}–${start + 9} — pass an explicit \`--port\`.`);
}

async function runDev(argv) {
  let plan;
  try {
    plan = parseDevArgs(argv, process.cwd());
  } catch (err) {
    fail(`${err.message}\n  Run \`papervine --help\`.`);
  }

  if (plan.help) {
    printHelp();
    return;
  }

  const problem = validateContentDir({
    dir: plan.dir,
    exists: existsSync(plan.dir),
    isDirectory: existsSync(plan.dir) && statSync(plan.dir).isDirectory(),
    hasDocsJson: existsSync(path.join(plan.dir, "docs.json")),
  });
  if (problem) fail(problem);

  if (!existsSync(SERVER_ENTRY)) {
    fail(
      `renderer not built — no server at ${SERVER_ENTRY}\n` +
        `  A published papervine ships this prebuilt. From a source checkout, run\n` +
        `  \`npm run prepack --workspace papervine\` first.`,
    );
  }

  const port = await resolvePort(plan.port, argv.includes("-p") || argv.includes("--port"));

  console.log(`${green("▲ papervine")} serving ${bold(plan.dir)}`);
  console.log(`  ${dim("→")} http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${port}\n`);

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PKG_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      PAPERVINE_CONTENT: plan.dir,
      PORT: String(port),
      HOSTNAME: HOST,
      NODE_ENV: "production",
    },
  });

  const forward = (sig) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

const [, , command, ...rest] = process.argv;

if (!command || command === "-h" || command === "--help" || command === "help") {
  printHelp();
} else if (command === "dev") {
  await runDev(rest);
} else if (command === "-v" || command === "--version" || command === "version") {
  const { version } = JSON.parse(
    await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(PKG_ROOT, "package.json"), "utf8"),
    ),
  );
  console.log(version);
} else {
  fail(`unknown command "${command}". Run \`papervine --help\`.`);
}
