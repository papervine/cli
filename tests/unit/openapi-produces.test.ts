import { describe, it, expect } from "vitest";
import { contentContext, type ContentSource } from "@papervine/renderer/lib/content";
import { apiOperations } from "@papervine/renderer/lib/openapi";

// The "Try it" playground seeds an Accept header from what an operation `produces` (the response
// media types) — many APIs 406 / return HTML without it, yet specs rarely declare Accept as an
// explicit parameter. Guard that the parser collects those media types.

function specSource(specPath: string, spec: object): ContentSource {
  return {
    async loadConfig() {
      throw new Error("unused");
    },
    async loadPage() {
      return null;
    },
    async listPageSlugs() {
      return [];
    },
    async loadRaw(p) {
      return p === specPath ? JSON.stringify(spec) : null;
    },
  };
}

const opsFor = (specPath: string, spec: object) =>
  contentContext.run(specSource(specPath, spec), () => apiOperations(specPath));

describe("apiOperations captures response media types (op.produces)", () => {
  it("collects application/json from a response", async () => {
    const ops = await opsFor("a.json", {
      openapi: "3.0.0",
      paths: {
        "/x": {
          get: {
            responses: {
              "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
            },
          },
        },
      },
    });
    expect(ops[0].produces).toEqual(["application/json"]);
  });

  it("dedupes across responses and keeps every distinct type", async () => {
    const ops = await opsFor("b.json", {
      openapi: "3.0.0",
      paths: {
        "/x": {
          get: {
            responses: {
              "200": { description: "ok", content: { "application/json": {}, "text/csv": {} } },
              "400": { description: "bad", content: { "application/json": {} } },
            },
          },
        },
      },
    });
    expect(ops[0].produces).toContain("application/json");
    expect(ops[0].produces).toContain("text/csv");
    expect(ops[0].produces.filter((t) => t === "application/json")).toHaveLength(1);
  });

  it("is empty when a response declares no content (e.g. 204)", async () => {
    const ops = await opsFor("c.json", {
      openapi: "3.0.0",
      paths: { "/x": { delete: { responses: { "204": { description: "no content" } } } } },
    });
    expect(ops[0].produces).toEqual([]);
  });
});