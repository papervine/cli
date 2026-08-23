import { describe, it, expect } from "vitest";
import {
  authFieldKeys,
  authOptionLabel,
  authorizationConflicts,
  clearCredentials,
  credentialScope,
  defaultAuthChoice,
  hasStoredCredentials,
  readAuthChoice,
  readCredentials,
  storageKey,
  writeAuthChoice,
  writeCredentials,
  type CredentialStore,
  type TryItAuth,
} from "@papervine/renderer/lib/try-it-credentials";

// The Try-it playground remembers credentials for the tab so a Basic-auth spec isn't retyped on
// every endpoint page (each one mounts its own modal, so component state alone is lost on
// navigation). This is that store's pure core: which fields belong to a scheme, what round-trips,
// and — the parts that matter for a *credential* store — that clearing really clears, that a
// foreign or corrupt entry can't inject fields into a request, and that broken storage degrades
// to "don't remember" rather than throwing inside the modal.

function fakeStore(initial: Record<string, string> = {}): CredentialStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const basic: TryItAuth = { key: "BasicAuth", type: "basic" };
// Storage functions take an opaque scope string (tenant + spec) — see `credentialScope`.
const SPEC = credentialScope("openapi.yaml", "/list-users");

describe("authFieldKeys", () => {
  it("gives basic a username and a password", () => {
    expect(authFieldKeys(basic)).toEqual(["BasicAuth.username", "BasicAuth.password"]);
  });

  it("gives apiKey a single value, and token schemes a token", () => {
    expect(authFieldKeys({ key: "k", type: "apiKey", in: "header", name: "X-Api-Key" })).toEqual([
      "k.value",
    ]);
    expect(authFieldKeys({ key: "k", type: "bearer" })).toEqual(["k.token"]);
    expect(authFieldKeys({ key: "k", type: "oauth2" })).toEqual(["k.token"]);
  });
});

describe("credential round-trip", () => {
  it("restores what was written, for the same spec", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], {
      "BasicAuth.username": "ada",
      "BasicAuth.password": "hunter2",
    });
    expect(readCredentials(store, SPEC, [basic])).toEqual({
      "BasicAuth.username": "ada",
      "BasicAuth.password": "hunter2",
    });
  });

  it("scopes by spec, so a second spec doesn't inherit them", () => {
    const store = fakeStore();
    const other = credentialScope("other/openapi.yaml", "/list-users");
    writeCredentials(store, SPEC, [basic], { "BasicAuth.username": "ada" });
    expect(readCredentials(store, other, [basic])).toEqual({});
    expect(storageKey(SPEC)).not.toBe(storageKey(other));
  });

  it("drops empty values and removes the entry once nothing is left", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], {
      "BasicAuth.username": "ada",
      "BasicAuth.password": "",
    });
    expect(readCredentials(store, SPEC, [basic])).toEqual({ "BasicAuth.username": "ada" });

    writeCredentials(store, SPEC, [basic], { "BasicAuth.username": "", "BasicAuth.password": "" });
    expect(store.data.has(storageKey(SPEC))).toBe(false);
    expect(readCredentials(store, SPEC, [basic])).toEqual({});
  });

  // "Forget" clears the whole scope, so it has to be offered on an operation whose own fields are
  // empty but whose spec still holds another operation's credentials.
  it("reports stored credentials for the spec, not just the current operation's", () => {
    const store = fakeStore();
    const oauth: TryItAuth = { key: "OAuth2", type: "oauth2" };
    expect(hasStoredCredentials(store, SPEC)).toBe(false);

    writeCredentials(store, SPEC, [oauth], { "OAuth2.token": "t" });
    expect(hasStoredCredentials(store, SPEC)).toBe(true);
    expect(readCredentials(store, SPEC, [basic])).toEqual({}); // nothing for *this* operation

    clearCredentials(store, SPEC);
    expect(hasStoredCredentials(store, SPEC)).toBe(false);
    expect(hasStoredCredentials(null, SPEC)).toBe(false);
  });

  it("clears on request", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], { "BasicAuth.username": "ada" });
    clearCredentials(store, SPEC);
    expect(readCredentials(store, SPEC, [basic])).toEqual({});
  });

  // One spec can point different operations at different schemes (an operation-level `security`
  // override), and each modal only knows its own operation's. Replacing the stored entry instead
  // of merging let saving on one endpoint wipe what was entered on another.
  it("keeps another operation's credentials when saving this one's", () => {
    const store = fakeStore();
    const apiKey: TryItAuth = { key: "ApiKeyAuth", type: "apiKey", in: "header", name: "X-Key" };
    const oauth: TryItAuth = { key: "OAuth2", type: "oauth2" };

    writeCredentials(store, SPEC, [apiKey], { "ApiKeyAuth.value": "k-123" });
    writeCredentials(store, SPEC, [oauth], { "OAuth2.token": "t-456" });

    expect(readCredentials(store, SPEC, [apiKey])).toEqual({ "ApiKeyAuth.value": "k-123" });
    expect(readCredentials(store, SPEC, [oauth])).toEqual({ "OAuth2.token": "t-456" });
  });

  it("clearing one operation's field doesn't delete another operation's credentials", () => {
    const store = fakeStore();
    const oauth: TryItAuth = { key: "OAuth2", type: "oauth2" };
    writeCredentials(store, SPEC, [basic], { "BasicAuth.username": "ada" });
    writeCredentials(store, SPEC, [oauth], { "OAuth2.token": "t" });

    writeCredentials(store, SPEC, [oauth], { "OAuth2.token": "" }); // reader empties it

    expect(readCredentials(store, SPEC, [oauth])).toEqual({});
    expect(readCredentials(store, SPEC, [basic])).toEqual({ "BasicAuth.username": "ada" });
  });

  it("persists only fields the current schemes declare", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], {
      "BasicAuth.username": "ada",
      "OldScheme.token": "leftover",
    });
    expect(JSON.parse(store.data.get(storageKey(SPEC))!)).toEqual({ "BasicAuth.username": "ada" });
  });
});

// sessionStorage is per-origin, which is per-tenant in subdomain mode — but apex path mode puts
// every tenant on one origin, where a spec path like `openapi.json` is not a distinguishing name.
describe("credentialScope", () => {
  it("separates co-hosted tenants that share a spec path", () => {
    const a = credentialScope("openapi.json", "/sites/acme/list-users");
    const b = credentialScope("openapi.json", "/sites/globex/list-users");
    expect(a).not.toBe(b);
    expect(storageKey(a)).not.toBe(storageKey(b));
  });

  it("separates two specs on one site, and is stable across that site's pages", () => {
    expect(credentialScope("a.json", "/sites/acme/x")).not.toBe(
      credentialScope("b.json", "/sites/acme/x"),
    );
    expect(credentialScope("a.json", "/sites/acme/x")).toBe(
      credentialScope("a.json", "/sites/acme/y"),
    );
  });

  it("is stable on a subdomain-mode path, where the origin already isolates the tenant", () => {
    expect(credentialScope("openapi.json", "/list-users")).toBe(
      credentialScope("openapi.json", "/get-user"),
    );
  });
});

// An AND requirement combining two Authorization-header schemes can't be sent as written — one
// header, one value. The playground says so instead of silently sending only the last one.
describe("authorizationConflicts", () => {
  const bearer: TryItAuth = { key: "BearerAuth", type: "bearer" };
  const header: TryItAuth = { key: "ApiKeyAuth", type: "apiKey", in: "header", name: "X-Api-Key" };

  it("flags two schemes that both write Authorization", () => {
    expect(authorizationConflicts([basic, bearer])).toEqual(["BasicAuth", "BearerAuth"]);
  });

  it("stays quiet for a single scheme, or schemes on different headers", () => {
    expect(authorizationConflicts([bearer])).toEqual([]);
    expect(authorizationConflicts([bearer, header])).toEqual([]);
    expect(authorizationConflicts([])).toEqual([]);
  });

  it("flags an apiKey the spec points at the Authorization header by name", () => {
    const named: TryItAuth = { key: "Legacy", type: "apiKey", in: "header", name: "Authorization" };
    expect(authorizationConflicts([bearer, named])).toEqual(["BearerAuth", "Legacy"]);
  });

  // The request builder puts a query-located apiKey in the query string, so it shares nothing with
  // the header but its name — warning about it would be a false alarm.
  it("ignores a query parameter that merely shares the name", () => {
    const q: TryItAuth = { key: "Legacy", type: "apiKey", in: "query", name: "authorization" };
    expect(authorizationConflicts([bearer, q])).toEqual([]);
  });

  // Same reasoning for a cookie: the builder folds it into `Cookie`, so it never touches the
  // Authorization header and warning about it would be a false alarm.
  it("ignores a cookie that merely shares the name", () => {
    const c: TryItAuth = { key: "Legacy", type: "apiKey", in: "cookie", name: "Authorization" };
    expect(authorizationConflicts([bearer, c])).toEqual([]);
  });
});

// Index 0 is the wrong default for `security: [{}, {BearerAuth: []}]`: it selects "No auth",
// renders no fields, and sends an unauthenticated request from a reader who has a token.
describe("defaultAuthChoice", () => {
  const bearer: TryItAuth = { key: "BearerAuth", type: "bearer" };

  it("skips a leading no-auth alternative", () => {
    expect(defaultAuthChoice([[], [bearer]])).toBe(1);
  });

  it("keeps the first option when it already asks for a credential", () => {
    expect(defaultAuthChoice([[basic], [bearer]])).toBe(0);
  });

  it("falls back to 0 when nothing asks for a credential", () => {
    expect(defaultAuthChoice([[]])).toBe(0);
    expect(defaultAuthChoice([])).toBe(0);
  });

  it("is what an unmatched or absent stored choice falls back to", () => {
    const options = [[], [bearer]];
    expect(readAuthChoice(fakeStore(), SPEC, options)).toBe(1);
    const stale = fakeStore();
    writeAuthChoice(stale, SPEC, [[{ key: "Gone", type: "bearer" }]], 0);
    expect(readAuthChoice(stale, SPEC, options)).toBe(1);
  });

  it("still restores an explicitly chosen No auth", () => {
    const store = fakeStore();
    const options = [[], [bearer]];
    writeAuthChoice(store, SPEC, options, 0);
    expect(readAuthChoice(store, SPEC, options)).toBe(0);
  });
});

describe("hostile and unusable storage", () => {
  it("ignores stored keys the schemes don't declare", () => {
    const store = fakeStore({
      [storageKey(SPEC)]: JSON.stringify({ "BasicAuth.username": "ada", "Evil.token": "x" }),
    });
    expect(readCredentials(store, SPEC, [basic])).toEqual({ "BasicAuth.username": "ada" });
  });

  it("ignores non-string values and corrupt or non-object entries", () => {
    expect(
      readCredentials(
        fakeStore({ [storageKey(SPEC)]: JSON.stringify({ "BasicAuth.username": { a: 1 } }) }),
        SPEC,
        [basic],
      ),
    ).toEqual({});
    expect(readCredentials(fakeStore({ [storageKey(SPEC)]: "not json" }), SPEC, [basic])).toEqual({});
    expect(readCredentials(fakeStore({ [storageKey(SPEC)]: "[1,2]" }), SPEC, [basic])).toEqual({});
  });

  it("degrades to not remembering when storage is absent or throws", () => {
    const throwing: CredentialStore = {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("disabled");
      },
    };
    expect(readCredentials(null, SPEC, [basic])).toEqual({});
    expect(readCredentials(throwing, SPEC, [basic])).toEqual({});
    expect(() => writeCredentials(throwing, SPEC, [basic], { "BasicAuth.username": "ada" })).not.toThrow();
    expect(() => writeCredentials(null, SPEC, [basic], {})).not.toThrow();
    expect(() => clearCredentials(throwing, SPEC)).not.toThrow();
  });

  it("reads nothing when the operation declares no security", () => {
    const store = fakeStore({ [storageKey(SPEC)]: JSON.stringify({ "BasicAuth.username": "ada" }) });
    expect(readCredentials(store, SPEC, [])).toEqual({});
  });
});

// When a spec offers alternatives (Basic *or* Bearer), the reader picks one — and picking Bearer
// on one endpoint only to land back on Basic at the next one is the same annoyance as retyping the
// credential. The choice is remembered by label, not index, so reordering the spec's `security`
// list can't silently select a different scheme.
describe("remembered auth choice", () => {
  const bearer: TryItAuth = { key: "BearerAuth", type: "bearer" };
  const options: TryItAuth[][] = [[basic], [bearer]];

  it("labels an alternative by the schemes it requires", () => {
    expect(authOptionLabel([basic])).toBe("BasicAuth");
    expect(authOptionLabel([basic, bearer])).toBe("BasicAuth + BearerAuth");
    expect(authOptionLabel([])).toBe("No auth");
  });

  it("round-trips the choice", () => {
    const store = fakeStore();
    writeAuthChoice(store, SPEC, options, 1);
    expect(readAuthChoice(store, SPEC, options)).toBe(1);
  });

  it("follows the label when the spec reorders its alternatives", () => {
    const store = fakeStore();
    writeAuthChoice(store, SPEC, options, 1); // BearerAuth, at index 1
    expect(readAuthChoice(store, SPEC, [[bearer], [basic]])).toBe(0); // still BearerAuth
  });

  it("falls back to the first option when the stored one is gone, absent, or unreadable", () => {
    const gone = fakeStore();
    writeAuthChoice(gone, SPEC, options, 1);
    expect(readAuthChoice(gone, SPEC, [[basic]])).toBe(0);
    expect(readAuthChoice(fakeStore(), SPEC, options)).toBe(0);
    expect(readAuthChoice(null, SPEC, options)).toBe(0);
    expect(
      readAuthChoice(
        {
          getItem: () => {
            throw new Error("disabled");
          },
          setItem: () => {},
          removeItem: () => {},
        },
        SPEC,
        options,
      ),
    ).toBe(0);
  });

  it("ignores a write for an index the options don't have", () => {
    const store = fakeStore();
    writeAuthChoice(store, SPEC, options, 7);
    expect(store.data.size).toBe(0);
    expect(readAuthChoice(store, SPEC, options)).toBe(0);
  });

  it("keeps the choice separate from the credentials it clears", () => {
    const store = fakeStore();
    writeAuthChoice(store, SPEC, options, 1);
    writeCredentials(store, SPEC, [bearer], { "BearerAuth.token": "t" });
    clearCredentials(store, SPEC);
    expect(readCredentials(store, SPEC, [bearer])).toEqual({});
    expect(readAuthChoice(store, SPEC, options)).toBe(1); // a preference, not a secret
  });
});