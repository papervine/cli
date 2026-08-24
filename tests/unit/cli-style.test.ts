import { afterEach, describe, expect, it, vi } from "vitest";

// The published CLI's terminal styling (`apps/cli/bin/style.mjs`). Two things here are worth
// pinning at this layer rather than discovering from a bug report:
//
//  1. **The colour-level decision.** It's pure logic over env + isTTY, and its failure mode is
//     silent — reorder the `NO_COLOR` check below the `FORCE_COLOR` one and escape codes start
//     leaking into pipes and CI logs, which no other suite would notice. The tier also has to
//     degrade rather than emit a truecolor escape at a 256-colour terminal that would render it
//     as garbage.
//  2. **Row alignment measures the *undecorated* label.** Padding a coloured string by
//     `String.length` counts the escape bytes as display width, so every row after the first
//     drifts. Trivially easy to reintroduce, invisible in a test that only asserts content.
//
// The level is captured once at module load (so the decision isn't re-made per call), which is
// why each case needs `vi.resetModules()` + a dynamic import — same pattern as the collab
// secret in `collab-auth.test.ts`.

type Style = typeof import("../../apps/cli/bin/style.mjs");

const COLOR_ENV = ["NO_COLOR", "FORCE_COLOR", "TERM", "COLORTERM"] as const;
const saved = Object.fromEntries(COLOR_ENV.map((k) => [k, process.env[k]]));
const savedIsTTY = process.stdout.isTTY;

/** Load style.mjs fresh under a given env + TTY-ness. */
async function loadStyle(
  env: Partial<Record<(typeof COLOR_ENV)[number], string | undefined>>,
  { isTTY = true }: { isTTY?: boolean } = {},
): Promise<Style> {
  vi.resetModules();
  for (const key of COLOR_ENV) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // Vitest runs without a TTY, so the "attached to a terminal" case has to be simulated —
  // otherwise every test would take the piped branch and the tiers would be untestable.
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
  return import("../../apps/cli/bin/style.mjs");
}

afterEach(() => {
  for (const key of COLOR_ENV) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  Object.defineProperty(process.stdout, "isTTY", { value: savedIsTTY, configurable: true });
});

describe("colour level detection", () => {
  it("emits a truecolor escape for the brand purple when the terminal advertises truecolor", async () => {
    const { brand, styled } = await loadStyle({ COLORTERM: "truecolor" });
    expect(styled).toBe(true);
    // #7C3AED — the same value docs.json gives the rendered site.
    expect(brand("X")).toBe("\x1b[38;2;124;58;237mX\x1b[39m");
  });

  it("accepts 24bit as a truecolor signal too", async () => {
    const { brand } = await loadStyle({ COLORTERM: "24bit" });
    expect(brand("X")).toBe("\x1b[38;2;124;58;237mX\x1b[39m");
  });

  it("falls back to the 256-colour palette when truecolor isn't advertised", async () => {
    const { brand, brandLight } = await loadStyle({ COLORTERM: undefined });
    expect(brand("X")).toBe("\x1b[38;5;99mX\x1b[39m");
    expect(brandLight("X")).toBe("\x1b[38;5;141mX\x1b[39m");
  });

  it("emits no escapes when stdout is not a terminal", async () => {
    const { brand, bold, dim, styled } = await loadStyle({ COLORTERM: "truecolor" }, { isTTY: false });
    expect(styled).toBe(false);
    expect(brand("X")).toBe("X");
    expect(bold("X")).toBe("X");
    expect(dim("X")).toBe("X");
  });

  it("honours FORCE_COLOR through a pipe", async () => {
    const { brand } = await loadStyle(
      { FORCE_COLOR: "1", COLORTERM: "truecolor" },
      { isTTY: false },
    );
    expect(brand("X")).toBe("\x1b[38;2;124;58;237mX\x1b[39m");
  });

  it("honours NO_COLOR at a colour-capable terminal", async () => {
    const { brand, styled } = await loadStyle({ NO_COLOR: "1", COLORTERM: "truecolor" });
    expect(styled).toBe(false);
    expect(brand("X")).toBe("X");
  });

  it("lets NO_COLOR win over FORCE_COLOR", async () => {
    // no-color.org: the variable's presence turns colour off regardless of anything else.
    const { brand } = await loadStyle({ NO_COLOR: "1", FORCE_COLOR: "1", COLORTERM: "truecolor" });
    expect(brand("X")).toBe("X");
  });

  it("ignores an empty NO_COLOR, per the convention", async () => {
    const { brand } = await loadStyle({ NO_COLOR: "", COLORTERM: "truecolor" });
    expect(brand("X")).toBe("\x1b[38;2;124;58;237mX\x1b[39m");
  });

  it("treats FORCE_COLOR=0 as off", async () => {
    const { brand } = await loadStyle({ FORCE_COLOR: "0", COLORTERM: "truecolor" });
    expect(brand("X")).toBe("X");
  });

  it("emits nothing for TERM=dumb", async () => {
    const { brand } = await loadStyle({ TERM: "dumb", COLORTERM: "truecolor" });
    expect(brand("X")).toBe("X");
  });
});

describe("rows", () => {
  it("aligns descriptions on the undecorated label width, not the escaped byte length", async () => {
    const { rows } = await loadStyle({ COLORTERM: "truecolor" });
    const out = rows([
      ["dev [dir]", "Preview"],
      ["new [dir]", "Create"],
      ["-p, --port <port>", "Port"],
    ]);

    // Strip the escapes and the descriptions must line up in one column — the whole point.
    // The escaped lines differ in length by however many bytes the colour took, so the check
    // has to be made on the plain text.
    const plain = (out as string).split("\n").map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(plain).toHaveLength(3);

    // Longest label is 17 chars, indent 4, gap 2 → descriptions start at column 23.
    for (const [i, description] of ["Preview", "Create", "Port"].entries()) {
      expect(plain[i].indexOf(description)).toBe(23);
    }
  });

  it("still aligns when styling is off", async () => {
    const { rows } = await loadStyle({ NO_COLOR: "1" });
    const plain = (rows([
      ["a", "one"],
      ["bbbb", "two"],
    ]) as string).split("\n");
    // Widest label is 4, gap 2 → both descriptions start at column 10.
    expect(plain[0]).toBe("    a     one");
    expect(plain[1]).toBe("    bbbb  two");
  });

  it("honours a custom indent and gap", async () => {
    const { rows } = await loadStyle({ NO_COLOR: "1" });
    expect(rows([["a", "one"]], { indent: "", gap: 1 })).toBe("a one");
  });

  it("returns an empty string for no entries rather than throwing on Math.max()", async () => {
    // `Math.max()` of nothing is -Infinity, which would make `" ".repeat()` throw. The seed
    // argument in the implementation is what prevents it; this pins that it stays.
    const { rows } = await loadStyle({ NO_COLOR: "1" });
    expect(rows([])).toBe("");
  });
});