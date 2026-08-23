import { describe, it, expect, vi } from "vitest";
import { contentContext, type ContentSource } from "@papervine/renderer/lib/content";
import { apiOperations } from "@papervine/renderer/lib/openapi";

// The Try-it modal renders an auth input per security scheme (basic → username + password,
// bearer/oauth2 → a token, apiKey → a header/query value). That needs `apiOperations` to resolve
// each operation's `security` against `components.securitySchemes` into `op.auth`. Guard the
// mapping — a miss silently drops the Authorization section from the playground.
//
// `op.auth` is nested because `security` is: the outer list is OR (alternatives the reader picks
// between), each inner object is AND. Reading only the first alternative is exactly the bug that
// made a spec offering "Basic or Bearer" show Basic and silently drop Bearer.

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

async function authFor(specPath: string, spec: object) {
  const ops = await contentContext.run(specSource(specPath, spec), () => apiOperations(specPath));
  return ops[0].auth;
}

describe("apiOperations resolves security schemes into op.auth", () => {
  const base = {
    openapi: "3.0.0",
    security: [{ scheme: [] }],
    paths: { "/x": { get: { operationId: "x" } } },
  };

  it("maps http basic to a basic scheme", async () => {
    const auth = await authFor("basic.json", {
      ...base,
      components: { securitySchemes: { scheme: { type: "http", scheme: "basic" } } },
    });
    expect(auth).toEqual([[{ key: "scheme", type: "basic", description: undefined }]]);
  });

  it("maps http bearer to a bearer scheme, carrying bearerFormat", async () => {
    const auth = await authFor("bearer.json", {
      ...base,
      components: {
        securitySchemes: { scheme: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      },
    });
    expect(auth[0][0]).toMatchObject({ type: "bearer", format: "JWT" });
  });

  it("maps apiKey, carrying its location and header name", async () => {
    const auth = await authFor("apikey.json", {
      ...base,
      components: {
        securitySchemes: { scheme: { type: "apiKey", in: "header", name: "X-Api-Key" } },
      },
    });
    expect(auth[0][0]).toMatchObject({ type: "apiKey", in: "header", name: "X-Api-Key" });
  });

  it("returns no auth when the spec declares no security", async () => {
    const auth = await authFor("none.json", {
      openapi: "3.0.0",
      paths: { "/x": { get: { operationId: "x" } } },
    });
    expect(auth).toEqual([]);
  });
});

describe("security alternatives (OR) vs. combinations (AND)", () => {
  const schemes = {
    BasicAuth: { type: "http", scheme: "basic" },
    BearerAuth: { type: "http", scheme: "bearer" },
  };
  const paths = { "/x": { get: { operationId: "x" } } };

  it("keeps every OR alternative — the bug was showing only the first", async () => {
    const auth = await authFor("or.json", {
      openapi: "3.0.0",
      components: { securitySchemes: schemes },
      security: [{ BasicAuth: [] }, { BearerAuth: [] }],
      paths,
    });
    expect(auth.map((option) => option.map((s) => s.type))).toEqual([["basic"], ["bearer"]]);
  });

  it("ANDs the keys of a single requirement into one alternative", async () => {
    const auth = await authFor("and.json", {
      openapi: "3.0.0",
      components: { securitySchemes: schemes },
      security: [{ BasicAuth: [], BearerAuth: [] }],
      paths,
    });
    expect(auth.map((option) => option.map((s) => s.type))).toEqual([["basic", "bearer"]]);
  });

  it("keeps an empty requirement as the 'no auth needed' alternative", async () => {
    const auth = await authFor("optional.json", {
      openapi: "3.0.0",
      components: { securitySchemes: schemes },
      security: [{ BearerAuth: [] }, {}],
      paths,
    });
    expect(auth).toHaveLength(2);
    expect(auth[1]).toEqual([]);
  });

  it("lets an operation's security override the root's", async () => {
    const auth = await authFor("op-level.json", {
      openapi: "3.0.0",
      components: { securitySchemes: schemes },
      security: [{ BasicAuth: [] }],
      paths: { "/x": { get: { operationId: "x", security: [{ BearerAuth: [] }] } } },
    });
    expect(auth.map((option) => option.map((s) => s.key))).toEqual([["BearerAuth"]]);
  });

  // A dangling scheme reference is a broken spec. Keeping it as an empty alternative would render
  // as "No auth" and tell readers the endpoint is open when it isn't — drop it instead.
  it("drops a requirement naming only schemes the spec never defines", async () => {
    const auth = await authFor("ghost.json", {
      openapi: "3.0.0",
      components: { securitySchemes: schemes },
      security: [{ BasicAuth: [] }, { GhostAuth: [] }],
      paths,
    });
    expect(auth.map((option) => option.map((s) => s.key))).toEqual([["BasicAuth"]]);
  });

  // Scopes don't reach the playground (they change neither the input nor the request), so two
  // scope-differentiated alternatives would render as identical, unpickable buttons.
  it("collapses alternatives that differ only by OAuth2 scope", async () => {
    const auth = await authFor("scopes.json", {
      openapi: "3.0.0",
      components: { securitySchemes: { OAuth2: { type: "oauth2" } } },
      security: [{ OAuth2: ["read"] }, { OAuth2: ["write"] }],
      paths,
    });
    expect(auth.map((option) => option.map((s) => s.key))).toEqual([["OAuth2"]]);
  });

  it("keeps the resolvable half of a mixed requirement", async () => {
    const auth = await authFor("half-ghost.json", {
      openapi: "3.0.0",
      components: { securitySchemes: schemes },
      security: [{ BasicAuth: [], GhostAuth: [] }],
      paths,
    });
    expect(auth.map((option) => option.map((s) => s.key))).toEqual([["BasicAuth"]]);
  });
});

// A requirement can be *partly* broken: `{ApiKeyAuth: [], BearerAuth: []}` where only one is
// defined. Keeping the resolvable half is right — a partial alternative beats none — but the
// playground then presents a complete-looking option that omits a required credential, so the
// author needs a signal. Nothing resolvable at all is still dropped.
describe("partially resolvable requirements", () => {
  const paths = { "/x": { get: { operationId: "x" } } };

  it("keeps what resolves and warns about what didn't", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = await authFor("partial.json", {
      openapi: "3.0.0",
      components: { securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "K" } } },
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      paths,
    });
    expect(auth.map((o) => o.map((s) => s.key))).toEqual([["ApiKeyAuth"]]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("BearerAuth"));
    warn.mockRestore();
  });

  it("stays quiet when every scheme resolves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await authFor("whole.json", {
      openapi: "3.0.0",
      components: { securitySchemes: { BasicAuth: { type: "http", scheme: "basic" } } },
      security: [{ BasicAuth: [] }],
      paths,
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});