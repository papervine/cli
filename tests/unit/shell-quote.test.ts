import { describe, it, expect } from "vitest";
import { shellQuote } from "@papervine/renderer/lib/shell-quote";

// The API reference's cURL samples exist to be pasted into a terminal, and they carry real reader
// input — a path parameter value, a password. Anything that survives to the clipboard has to
// survive the shell too.

describe("shellQuote", () => {
  it("quotes a plain value", () => {
    expect(shellQuote("https://api.example.com/v1/users")).toBe("'https://api.example.com/v1/users'");
  });

  it("neutralises characters that would run as shell syntax", () => {
    // `&` backgrounds the command, `<` redirects, `;` ends it, `$(…)` would execute.
    expect(shellQuote("https://x/y?a=1&b=2")).toBe("'https://x/y?a=1&b=2'");
    expect(shellQuote("Authorization: Basic <credentials>")).toBe(
      "'Authorization: Basic <credentials>'",
    );
    expect(shellQuote("a; rm -rf /")).toBe("'a; rm -rf /'");
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
  });

  // The one character single quotes can't hold: it ends the string. Left raw, `/users/o'brien`
  // produces an unbalanced quote and the shell hangs waiting for the rest.
  it("escapes an apostrophe by closing, escaping, and reopening", () => {
    expect(shellQuote("o'brien")).toBe("'o'\\''brien'");
    expect(shellQuote("pa'ss'word")).toBe("'pa'\\''ss'\\''word'");
  });

  it("balances its quotes no matter what it's given", () => {
    for (const value of ["", "'", "''", "a'b", "'leading", "trailing'", "a\nb"]) {
      const quoted = shellQuote(value);
      // Every `'` is either a delimiter or backslash-escaped — count them the way a shell would.
      const unescaped = quoted.replace(/\\'/g, "").match(/'/g)?.length ?? 0;
      expect(unescaped % 2).toBe(0);
    }
  });
});