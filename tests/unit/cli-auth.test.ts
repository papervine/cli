import { describe, expect, it } from "vitest";

import {
  CLIENT_ID,
  DEFAULT_API_URL,
  authEndpoint,
  credentialsPath,
  emptyStore,
  formatUserCode,
  normalizeApiOrigin,
  parseAuthArgs,
  parseStore,
  pollDecision,
  readCredential,
  removeCredential,
  resolveApiOrigin,
  upsertCredential,
  verificationTarget,
} from "../../apps/cli/bin/auth.mjs";

// The published CLI's account layer (`apps/cli/bin/auth.mjs`) — `papervine signup` / `login` /
// `logout` / `whoami`. The bin script does the fetching, the browser launch and the file writes;
// everything decided along the way lives here, so the awkward parts are testable without a
// control plane: the RFC 8628 polling rules, the credential store's tolerance for a mangled
// file, and the two URLs the flow sends a human to.

describe("parseAuthArgs", () => {
  it("defaults to opening a browser against no explicit control plane", () => {
    expect(parseAuthArgs([])).toEqual({ help: false, url: undefined, browser: true });
  });

  it("takes --url and --no-browser", () => {
    expect(parseAuthArgs(["--url", "https://docs.acme.dev", "--no-browser"])).toEqual({
      help: false,
      url: "https://docs.acme.dev",
      browser: false,
    });
  });

  it("rejects a positional — these commands take no directory", () => {
    expect(() => parseAuthArgs(["./docs"])).toThrow(/no directory/);
  });

  it("rejects an empty --url rather than falling back silently", () => {
    expect(() => parseAuthArgs(["--url", "  "])).toThrow(/--url needs a value/);
  });
});

describe("normalizeApiOrigin", () => {
  it("assumes https for a bare host — a token travels over this", () => {
    expect(normalizeApiOrigin("papervine.io")).toBe("https://papervine.io");
  });

  it("assumes http only for local hosts, which have no certificate", () => {
    expect(normalizeApiOrigin("app.localhost:3000")).toBe("http://app.localhost:3000");
    expect(normalizeApiOrigin("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("keeps an explicit scheme and drops path/query", () => {
    expect(normalizeApiOrigin("http://papervine.test/device?x=1")).toBe("http://papervine.test");
  });

  it("refuses a non-http scheme and garbage", () => {
    expect(() => normalizeApiOrigin("ftp://papervine.io")).toThrow(/unsupported scheme/);
    expect(() => normalizeApiOrigin("")).toThrow(/no control-plane URL/);
  });
});

describe("resolveApiOrigin", () => {
  it("prefers --url, then PAPERVINE_API_URL, then the hosted default", () => {
    const env = { PAPERVINE_API_URL: "https://env.example" };
    expect(resolveApiOrigin({ url: "https://flag.example" }, env)).toBe("https://flag.example");
    expect(resolveApiOrigin({}, env)).toBe("https://env.example");
    expect(resolveApiOrigin({}, {})).toBe(DEFAULT_API_URL);
  });
});

describe("authEndpoint", () => {
  it("addresses Better Auth's device endpoints", () => {
    expect(authEndpoint("https://papervine.io", "/device/code")).toBe(
      "https://papervine.io/api/auth/device/code",
    );
  });
});

describe("credentialsPath", () => {
  it("honours XDG_CONFIG_HOME", () => {
    expect(credentialsPath({ env: { XDG_CONFIG_HOME: "/x/cfg" }, home: "/home/u" })).toBe(
      "/x/cfg/papervine/credentials.json",
    );
  });

  it("falls back to ~/.config, not a dotfile in the home directory", () => {
    expect(credentialsPath({ env: {}, home: "/home/u" })).toBe(
      "/home/u/.config/papervine/credentials.json",
    );
  });

  it("uses APPDATA on Windows", () => {
    expect(
      credentialsPath({ env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, platform: "win32" }),
    ).toBe("C:\\Users\\u\\AppData\\Roaming\\papervine\\credentials.json");
  });
});

describe("the credential store", () => {
  it("treats a corrupt or hand-edited file as empty rather than failing", () => {
    // Being asked to sign in again is a much better outcome than a CLI that refuses to run
    // because its cache is malformed.
    expect(parseStore("not json")).toEqual(emptyStore());
    expect(parseStore("[1,2,3]")).toEqual(emptyStore());
    expect(parseStore('{"credentials": 4}')).toEqual(emptyStore());
    expect(parseStore("")).toEqual(emptyStore());
  });

  it("round-trips a credential per origin", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const store = upsertCredential(emptyStore(), "https://papervine.io", {
      accessToken: "tok",
      expiresIn: 3600,
      email: "a@b.c",
    }, now);
    expect(readCredential(store, "https://papervine.io", now)).toMatchObject({
      accessToken: "tok",
      email: "a@b.c",
      expiresAt: "2026-01-01T01:00:00.000Z",
    });
    // Keyed by origin, so a self-hosted control plane isn't a conflict with the hosted one.
    expect(readCredential(store, "https://acme.dev", now)).toBeNull();
  });

  it("reads an expired credential as absent", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const store = upsertCredential(emptyStore(), "https://papervine.io", {
      accessToken: "tok",
      expiresIn: 60,
    }, now);
    // Reporting "signed in" and then sending a dead token produces a bare 401, which reads as
    // "something is broken" rather than "sign in again".
    expect(readCredential(store, "https://papervine.io", now + 61_000)).toBeNull();
  });

  it("keeps other origins when one is removed, and says whether anything was", () => {
    let store = upsertCredential(emptyStore(), "https://a.example", { accessToken: "1" });
    store = upsertCredential(store, "https://b.example", { accessToken: "2" });

    const hit = removeCredential(store, "https://a.example");
    expect(hit.removed).toBe(true);
    expect(Object.keys(hit.store.credentials)).toEqual(["https://b.example"]);

    // `logout` reporting success when nothing happened hides a mistyped --url.
    expect(removeCredential(hit.store, "https://a.example").removed).toBe(false);
  });
});

describe("verificationTarget", () => {
  const base = {
    verificationUri: "https://app.papervine.io/device",
    verificationUriComplete: "https://app.papervine.io/device?user_code=ABCD1234",
    userCode: "ABCD1234",
  };

  it("login uses the server's own complete URI — nothing to type", () => {
    expect(verificationTarget(base)).toBe(base.verificationUriComplete);
  });

  it("builds the complete URI itself when the server omitted it", () => {
    expect(verificationTarget({ ...base, verificationUriComplete: undefined })).toBe(
      "https://app.papervine.io/device?user_code=ABCD1234",
    );
  });

  it("signup lands on the sign-up form and carries the code in ?redirect=", () => {
    // The whole point of the extra hop: the browser has to reach the form BEFORE the approval
    // page, and the control plane resumes the device approval once an account exists.
    expect(verificationTarget({ ...base, create: true })).toBe(
      "https://app.papervine.io/signup?redirect=%2Fdevice%3Fuser_code%3DABCD1234",
    );
  });

  it("keeps the app host from the verification URI, not the API origin", () => {
    // Approving needs a session, and the session cookie is host-only on `app.` — so signup's
    // URL must be built on whatever host the server named, never on the API origin.
    expect(
      verificationTarget({
        verificationUri: "http://app.localhost:3000/device",
        userCode: "WXYZ7788",
        create: true,
      }),
    ).toBe("http://app.localhost:3000/signup?redirect=%2Fdevice%3Fuser_code%3DWXYZ7788");
  });
});

describe("formatUserCode", () => {
  it("groups a bare code for reading and typing", () => {
    expect(formatUserCode("ABCD1234")).toBe("ABCD-1234");
    expect(formatUserCode("ABCDE1234")).toBe("ABCDE-1234");
  });

  it("leaves an already-grouped or implausible code alone", () => {
    expect(formatUserCode("AB-CD")).toBe("AB-CD");
    expect(formatUserCode("ABC")).toBe("ABC");
  });
});

describe("pollDecision (RFC 8628 §3.5)", () => {
  it("finishes on success", () => {
    expect(pollDecision({ ok: true }, 5)).toEqual({ action: "done", intervalSeconds: 5 });
  });

  it("keeps waiting at the same interval while authorization is pending", () => {
    expect(pollDecision({ error: "authorization_pending" }, 5)).toEqual({
      action: "wait",
      intervalSeconds: 5,
    });
  });

  it("widens the interval by 5s on slow_down, permanently", () => {
    // Not a retry-once concession: the RFC requires the increase to stick, and a client that
    // ignores it gets throttled or blocked.
    const first = pollDecision({ error: "slow_down" }, 5);
    expect(first).toEqual({ action: "wait", intervalSeconds: 10 });
    expect(pollDecision({ error: "slow_down" }, first.intervalSeconds).intervalSeconds).toBe(15);
  });

  it("stops with a human reason on denial and expiry", () => {
    expect(pollDecision({ error: "access_denied" }, 5)).toMatchObject({
      action: "stop",
      message: expect.stringContaining("denied"),
    });
    expect(pollDecision({ error: "expired_token" }, 5)).toMatchObject({
      action: "stop",
      message: expect.stringContaining("expired"),
    });
  });

  it("stops rather than spinning on an error it doesn't recognize", () => {
    // Polling forever against a server that is telling us something we don't understand is how
    // a "hung" CLI happens.
    expect(pollDecision({ error: "teapot", errorDescription: "I am a teapot" }, 5)).toEqual({
      action: "stop",
      intervalSeconds: 5,
      message: "I am a teapot",
    });
  });

  it("falls back to a sane interval when handed a nonsense one", () => {
    expect(pollDecision({ error: "authorization_pending" }, 0).intervalSeconds).toBe(5);
    expect(pollDecision({ error: "authorization_pending" }, NaN).intervalSeconds).toBe(5);
  });
});

describe("CLIENT_ID", () => {
  it("is a stable public identifier — it is shown on the approval screen", () => {
    expect(CLIENT_ID).toBe("papervine-cli");
  });
});