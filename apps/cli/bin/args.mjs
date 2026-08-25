// The CLI's pure decision core, split out of `papervine.mjs` so it can be
// unit-tested without spawning a server or touching the filesystem
// (`tests/unit/cli-args.test.ts`). Everything here is a pure function: the bin
// script does the I/O and the process management, this decides what to do.

import { parseArgs } from "node:util";
import path from "node:path";

export const DEFAULT_PORT = 3000;

/**
 * Parse the arguments shared by `papervine dev` and `papervine serve`.
 *
 * One parser for both because they run the *same server* — the difference is framing and two
 * defaults (see `mode` below), not behaviour worth a second flag surface.
 *
 * @param {string[]} argv - args after the subcommand
 * @param {string} cwd - resolved against, so the result is always absolute
 * @returns {{help: boolean, port: number, dir: string, yes: boolean, portExplicit: boolean,
 *            host: string|undefined, hostExplicit: boolean}}
 * @throws {Error} on an unknown flag or an unusable --port
 */
export function parseServerArgs(argv, cwd) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      port: { type: "string", short: "p" },
      // The bind address. A flag as well as `PAPERVINE_HOST`, because a production deployment
      // shouldn't need an environment variable to reach its own network — and a flag is
      // self-documenting in a Dockerfile CMD in a way an env var isn't.
      host: { type: "string" },
      // Scaffold without asking when there are no docs. Declared here rather than sniffed out
      // of argv, because `parseArgs` rejects an undeclared flag before any such check could run.
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    return {
      help: true,
      port: DEFAULT_PORT,
      dir: cwd,
      yes: false,
      portExplicit: false,
      host: undefined,
      hostExplicit: false,
    };
  }

  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    // parseArgs hands back a string; reject anything that isn't a real port rather
    // than letting `NaN` reach the server and surface as an opaque listen error.
    if (!/^\d+$/.test(values.port)) {
      throw new Error(`--port must be a number, got "${values.port}"`);
    }
    port = Number(values.port);
    if (port < 1 || port > 65535) {
      throw new Error(`--port must be between 1 and 65535, got ${port}`);
    }
  }

  if (positionals.length > 1) {
    throw new Error(
      `expected at most one directory, got ${positionals.length}: ${positionals.join(", ")}`,
    );
  }

  if (values.host !== undefined && values.host.trim() === "") {
    throw new Error("--host needs a value, e.g. --host 0.0.0.0");
  }

  return {
    help: false,
    port,
    dir: path.resolve(cwd, positionals[0] ?? "."),
    yes: Boolean(values.yes),
    // An explicit `--port` is a request, not a suggestion: the caller told us where to serve,
    // so a busy port is an error rather than something to quietly move away from.
    portExplicit: values.port !== undefined,
    host: values.host?.trim(),
    hostExplicit: values.host !== undefined,
  };
}


/**
 * Parse `papervine new` arguments.
 *
 * @param {string[]} argv - args after the `new` subcommand
 * @param {string} cwd
 * @returns {{help: boolean, force: boolean, dir: string}}
 * @throws {Error} on an unknown flag or more than one directory
 */
export function parseNewArgs(argv, cwd) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      force: { type: "boolean", short: "f" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) return { help: true, force: false, dir: cwd };
  if (positionals.length > 1) {
    throw new Error(
      `expected at most one directory, got ${positionals.length}: ${positionals.join(", ")}`,
    );
  }
  return { help: false, force: Boolean(values.force), dir: path.resolve(cwd, positionals[0] ?? ".") };
}

/**
 * Decide whether a directory can be scaffolded into. Pure: takes probe results, not paths.
 *
 * Scaffolding writes files, so the default is to refuse anything that isn't empty — overwriting
 * someone's work because they mistyped a path is unrecoverable, and `--force` is a cheap way to
 * say you meant it. A directory that doesn't exist yet is the normal case and fine; it gets
 * created.
 *
 * "Empty" ignores dotfiles, because a freshly `git init`ed or editor-opened directory is empty
 * in every sense the user cares about, and refusing there would be pedantic.
 *
 * @param {{dir: string, exists: boolean, isDirectory: boolean, entries: string[], force: boolean}} probe
 * @returns {string | null} an error message, or null when the directory is usable
 */
export function validateNewTarget({ dir, exists, isDirectory, entries, force }) {
  if (exists && !isDirectory) return `not a directory: ${dir}`;
  if (!exists) return null;
  if (force) return null;
  const visible = entries.filter((name) => !name.startsWith("."));
  if (visible.length) {
    return (
      `${dir} is not empty (${visible.slice(0, 3).join(", ")}${visible.length > 3 ? ", …" : ""})\n` +
      `  Scaffolding would write over what's there. Pass a new directory, or --force if you\n` +
      `  meant this one.`
    );
  }
  return null;
}

/**
 * Decide whether a directory is a previewable docs repo. Takes the filesystem
 * probe results as inputs rather than doing the probing, so it stays pure.
 *
 * `command` only shapes the hint: being told to run `papervine dev ./docs` after typing
 * `papervine serve` is a small thing that reads as the tool not listening.
 *
 * @param {{dir: string, exists: boolean, isDirectory: boolean, hasDocsJson: boolean,
 *          command?: string}} probe
 * @returns {string | null} an error message, or null when the directory is usable
 */
export function validateContentDir({ dir, exists, isDirectory, hasDocsJson, command = "dev" }) {
  if (!exists) return `directory not found: ${dir}`;
  if (!isDirectory) return `not a directory: ${dir}`;
  if (!hasDocsJson) {
    return (
      `no docs.json in ${dir}\n` +
      `  A Papervine docs repo needs a docs.json at its root.\n` +
      `  Pass the folder that contains it, e.g. \`papervine ${command} ./docs\`.`
    );
  }
  return null;
}
