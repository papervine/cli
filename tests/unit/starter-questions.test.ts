import { describe, expect, it } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import {
  MAX_STARTER_QUESTIONS,
  normalizeStarterQuestions,
} from "@papervine/renderer/lib/starter-questions";

/**
 * The empty-state list is untrusted (docs.json, a dashboard payload). These pin the
 * coerce-don't-throw contract: junk becomes fewer questions, never a thrown error, and
 * the chat UI never sees more than three.
 */
describe("normalizeStarterQuestions", () => {
  it("returns an empty list for a missing or non-array value", () => {
    expect(normalizeStarterQuestions(undefined)).toEqual([]);
    expect(normalizeStarterQuestions(null)).toEqual([]);
    expect(normalizeStarterQuestions("How do I start?")).toEqual([]);
    expect(normalizeStarterQuestions({ starterQuestions: ["x"] })).toEqual([]);
  });

  it("keeps a clean list of up to three questions, in order", () => {
    expect(
      normalizeStarterQuestions([
        "How do I get started?",
        "How do I customize the theme?",
        "How do I add an OpenAPI spec?",
      ]),
    ).toEqual([
      "How do I get started?",
      "How do I customize the theme?",
      "How do I add an OpenAPI spec?",
    ]);
  });

  it("trims, drops empties and non-strings, and de-duplicates", () => {
    expect(
      normalizeStarterQuestions([
        "  How do I get started?  ",
        "",
        "   ",
        42,
        null,
        "How do I get started?",
        { q: "nope" },
        "Which components can I use?",
      ]),
    ).toEqual(["How do I get started?", "Which components can I use?"]);
  });

  it(`caps at ${MAX_STARTER_QUESTIONS} — a fourth question is ignored, not an error`, () => {
    expect(
      normalizeStarterQuestions(["one", "two", "three", "four"]),
    ).toEqual(["one", "two", "three"]);
    expect(MAX_STARTER_QUESTIONS).toBe(3);
  });
});

describe("docs.json assistant.starterQuestions", () => {
  it("is parsed and not reported as unsupported", () => {
    const { config, warnings } = parseDocsConfig({
      name: "Acme",
      assistant: {
        starterQuestions: ["How do I get started?", "How do I deploy?"],
      },
    });

    expect(warnings).toEqual([]);
    expect(config.assistant?.starterQuestions).toEqual([
      "How do I get started?",
      "How do I deploy?",
    ]);
  });

  it("degrades a malformed assistant block rather than failing the site", () => {
    expect(parseDocsConfig({ name: "Acme", assistant: "yes" }).config.assistant).toBeUndefined();
    expect(
      parseDocsConfig({ name: "Acme", assistant: { starterQuestions: "one" } }).config.assistant
        ?.starterQuestions,
    ).toBeUndefined();
  });
});
