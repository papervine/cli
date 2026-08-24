import { describe, it, expect } from "vitest";
import { outcomeFromText } from "@papervine/renderer/lib/assistant-outcome";

// The Assistant page's "Answered / Not answered" split depends on this classifier marking a
// no-answer response as unanswered; everything else (a real answer) counts as answered.

describe("outcomeFromText", () => {
  it("marks a real answer as answered", () => {
    expect(outcomeFromText("You can deploy with `npm run build`. See [Quickstart](/quickstart).")).toBe("answered");
    expect(outcomeFromText("The API returns a 200 on success.")).toBe("answered");
  });

  it("marks explicit no-answer responses as unanswered", () => {
    expect(outcomeFromText("I don't have information on that in the documentation.")).toBe("unanswered");
    expect(outcomeFromText("The documentation does not cover this topic.")).toBe("unanswered");
    expect(outcomeFromText("Sorry, I couldn't find an answer in the docs.")).toBe("unanswered");
    expect(outcomeFromText("There's no information about pricing here.")).toBe("unanswered");
  });

  it("treats an empty response as unanswered", () => {
    expect(outcomeFromText("")).toBe("unanswered");
    expect(outcomeFromText("   ")).toBe("unanswered");
  });

  it("does not false-positive on answers that merely mention 'find' or 'know'", () => {
    expect(outcomeFromText("You can find the API key in Settings.")).toBe("answered");
    expect(outcomeFromText("To know your usage, open the Analytics tab.")).toBe("answered");
  });
});