import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  DEFAULT_PORT,
  parseDevArgs,
  validateContentDir,
} from "../../apps/cli/bin/args.mjs";

// The published CLI's decision layer (`apps/cli/bin/args.mjs`). The bin script is a
// thin shell around these two functions — it does the fs probing, port binding and
// process spawning, they decide what should happen — so this covers the argument
// surface without booting a server. Before this existed, nothing tested the bin at
// all: not the flags, not the "no docs.json" guard, nothing.

const CWD = "/repo";

describe("parseDevArgs", () => {
  it("defaults to the current directory on the default port", () => {
    expect(parseDevArgs([], CWD)).toEqual({
      help: false,
      port: DEFAULT_PORT,
      dir: CWD,
    });
  });

  it("resolves a relative directory against cwd", () => {
    expect(parseDevArgs(["./docs"], CWD).dir).toBe(path.resolve(CWD, "docs"));
  });

  it("keeps an absolute directory as given", () => {
    expect(parseDevArgs(["/elsewhere/docs"], CWD).dir).toBe("/elsewhere/docs");
  });

  it("accepts --port and -p", () => {
    expect(parseDevArgs(["--port", "4000"], CWD).port).toBe(4000);
    expect(parseDevArgs(["-p", "4000"], CWD).port).toBe(4000);
  });

  it("takes a port and a directory together, in either order", () => {
    expect(parseDevArgs(["-p", "4000", "./docs"], CWD)).toMatchObject({
      port: 4000,
      dir: path.resolve(CWD, "docs"),
    });
    expect(parseDevArgs(["./docs", "-p", "4000"], CWD)).toMatchObject({
      port: 4000,
      dir: path.resolve(CWD, "docs"),
    });
  });

  it("reports help without needing a valid directory", () => {
    expect(parseDevArgs(["--help"], CWD).help).toBe(true);
    expect(parseDevArgs(["-h"], CWD).help).toBe(true);
  });

  // A non-numeric port used to reach the server as NaN and surface as an opaque
  // listen failure; fail on the flag instead, where the message can name the flag.
  it("rejects a non-numeric port", () => {
    expect(() => parseDevArgs(["-p", "abc"], CWD)).toThrow(/--port must be a number/);
    expect(() => parseDevArgs(["-p", "80.5"], CWD)).toThrow(/--port must be a number/);
  });

  it("rejects an out-of-range port", () => {
    expect(() => parseDevArgs(["-p", "0"], CWD)).toThrow(/between 1 and 65535/);
    expect(() => parseDevArgs(["-p", "70000"], CWD)).toThrow(/between 1 and 65535/);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseDevArgs(["--porb", "4000"], CWD)).toThrow();
  });

  it("rejects more than one directory", () => {
    expect(() => parseDevArgs(["./a", "./b"], CWD)).toThrow(/at most one directory/);
  });
});

describe("validateContentDir", () => {
  const ok = { dir: "/repo/docs", exists: true, isDirectory: true, hasDocsJson: true };

  it("passes a directory containing docs.json", () => {
    expect(validateContentDir(ok)).toBeNull();
  });

  it("reports a missing directory", () => {
    expect(validateContentDir({ ...ok, exists: false })).toMatch(/directory not found/);
  });

  it("reports a path that is a file, not a directory", () => {
    expect(validateContentDir({ ...ok, isDirectory: false })).toMatch(/not a directory/);
  });

  // The most common misstep: running it one level up from the docs folder. The
  // message has to name the fix, not just the failure.
  it("reports a missing docs.json and suggests passing the subfolder", () => {
    const msg = validateContentDir({ ...ok, hasDocsJson: false });
    expect(msg).toMatch(/no docs\.json/);
    expect(msg).toMatch(/papervine dev \.\/docs/);
  });

  it("checks existence before docs.json, so a bad path says so", () => {
    expect(validateContentDir({ ...ok, exists: false, hasDocsJson: false })).toMatch(
      /directory not found/,
    );
  });
});