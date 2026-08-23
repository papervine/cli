import { describe, it, expect } from "vitest";
import { sampleAuth, sampleFromSchema, type AuthScheme } from "@papervine/renderer/lib/openapi";

// The page shows read-only cURL/JS/Python samples beside an interactive playground. They must
// agree about auth: the samples used to be derived only from an explicitly declared `Authorization`
// *parameter*, so any spec that declared its auth the normal way — a security scheme — rendered an
// unauthenticated sample next to a playground sending `Authorization: Basic …`.

describe("sampleAuth", () => {
  it("shows Basic and Bearer in the Authorization header", () => {
    expect(sampleAuth([{ key: "BasicAuth", type: "basic" }]).headers).toEqual([
      ["Authorization", "Basic <credentials>"],
    ]);
    expect(sampleAuth([{ key: "BearerAuth", type: "bearer" }]).headers).toEqual([
      ["Authorization", "Bearer <token>"],
    ]);
  });

  it("names the token after bearerFormat when the spec declares one", () => {
    const jwt: AuthScheme = { key: "BearerAuth", type: "bearer", format: "JWT" };
    expect(sampleAuth([jwt]).headers).toEqual([["Authorization", "Bearer <jwt>"]]);
  });

  it("puts an apiKey where the spec says it goes", () => {
    const header: AuthScheme = { key: "K", type: "apiKey", in: "header", name: "X-Api-Key" };
    const query: AuthScheme = { key: "K", type: "apiKey", in: "query", name: "api_key" };
    expect(sampleAuth([header])).toEqual({ headers: [["X-Api-Key", "<key>"]], query: [] });
    expect(sampleAuth([query])).toEqual({ headers: [], query: [["api_key", "<key>"]] });
  });

  it("carries every scheme of an AND requirement", () => {
    const schemes: AuthScheme[] = [
      { key: "K", type: "apiKey", in: "header", name: "X-Api-Key" },
      { key: "BearerAuth", type: "bearer" },
    ];
    expect(sampleAuth(schemes).headers).toEqual([
      ["X-Api-Key", "<key>"],
      ["Authorization", "Bearer <token>"],
    ]);
  });

  // Two schemes ANDed onto the same header can't both be sent. Emitting it twice would print a
  // duplicate `-H` in the cURL sample and a duplicate key in the JavaScript object literal.
  it("emits one header per name when an AND requirement collides on Authorization", () => {
    const schemes: AuthScheme[] = [
      { key: "BasicAuth", type: "basic" },
      { key: "BearerAuth", type: "bearer" },
    ];
    expect(sampleAuth(schemes).headers).toEqual([["Authorization", "Bearer <token>"]]);
  });

  // A cookie-located key is `Cookie: name=value`. Emitting a header *named* after the cookie
  // produces a snippet that 401s when pasted — newly-wrong output, worse than none.
  it("sends a cookie-located apiKey as a Cookie header", () => {
    const cookie: AuthScheme = { key: "K", type: "apiKey", in: "cookie", name: "session" };
    expect(sampleAuth([cookie])).toEqual({ headers: [["Cookie", "session=<key>"]], query: [] });
  });

  // One `Cookie` header carries them all — a session + CSRF pair is an ordinary requirement, and
  // overwriting would drop one credential silently.
  it("combines two cookie schemes into one header", () => {
    const schemes: AuthScheme[] = [
      { key: "S", type: "apiKey", in: "cookie", name: "session" },
      { key: "C", type: "apiKey", in: "cookie", name: "csrf" },
    ];
    expect(sampleAuth(schemes).headers).toEqual([["Cookie", "session=<key>; csrf=<key>"]]);
  });

  it("shows nothing for an operation with no security", () => {
    expect(sampleAuth([])).toEqual({ headers: [], query: [] });
  });
});

// `upgrade()` rewrites a 3.0 spec's `example: x` into 3.1's `examples: [x]`. Reading only
// `example` meant every author-written example — in most real specs, which are 3.0 — was dropped
// and replaced with a `"string"` placeholder in the generated code samples.
describe("sampleFromSchema reads upgraded examples", () => {
  it("prefers an explicit example, then an upgraded one, then a default", () => {
    expect(sampleFromSchema({ type: "string", example: "direct" })).toBe("direct");
    expect(sampleFromSchema({ type: "string", examples: ["upgraded"] })).toBe("upgraded");
    expect(sampleFromSchema({ type: "string", examples: [], default: "fallback" })).toBe("fallback");
    expect(sampleFromSchema({ type: "string" })).toBe("string");
  });

  it("uses them for object properties, which is where request bodies come from", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string", examples: ["O'Brien"] } },
    };
    expect(sampleFromSchema(schema)).toEqual({ name: "O'Brien" });
  });
});

// A playground field holds text. `upgrade()` moved 3.0 examples into `examples`, making this the
// path most real specs take — so an object example would now prefill "[object Object]" and send it.
describe("non-scalar examples", () => {
  it("still resolves for a request body, where JSON is fine", () => {
    const schema = {
      type: "object",
      properties: { range: { type: "object", examples: [{ from: "2024-01-01" }] } },
    };
    expect(sampleFromSchema(schema)).toEqual({ range: { from: "2024-01-01" } });
  });
});