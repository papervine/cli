import { describe, expect, it } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import {
  assistantSettingsFromConfig,
  deflectionMailto,
  formatSearchDomain,
  hostMatchesPattern,
  isBlockedHost,
  isSupportEmail,
  parseSearchDomain,
  urlMatchesAny,
  urlMatchesPattern,
} from "@papervine/renderer/lib/assistant-settings";

describe("assistantSettingsFromConfig", () => {
  it("is off when assistant is missing", () => {
    expect(assistantSettingsFromConfig({} as never)).toEqual({
      deflection: null,
      searchDomains: [],
    });
    expect(assistantSettingsFromConfig(undefined)).toEqual({
      deflection: null,
      searchDomains: [],
    });
  });

  it("enables deflection from a support email", () => {
    const settings = assistantSettingsFromConfig({
      assistant: { supportEmail: "support@example.com", showHelpButton: true },
    } as never);
    expect(settings.deflection).toEqual({
      enabled: true,
      email: "support@example.com",
      showHelpButton: true,
    });
  });

  it("reads the dashboard-shaped deflection object", () => {
    const settings = assistantSettingsFromConfig({
      assistant: {
        deflection: { email: "help@acme.io", showHelpButton: true },
        searchDomains: ["docs.acme.io", "acme.io/pricing"],
      },
    } as never);
    expect(settings.deflection?.email).toBe("help@acme.io");
    expect(settings.deflection?.showHelpButton).toBe(true);
    expect(settings.searchDomains.map(formatSearchDomain)).toEqual([
      "docs.acme.io",
      "acme.io/pricing",
    ]);
  });

  it("honors explicit enabled: false toggles", () => {
    const settings = assistantSettingsFromConfig({
      assistant: {
        supportEmail: "support@example.com",
        deflection: { enabled: false, email: "support@example.com" },
        searchDomains: { enabled: false, domains: ["docs.example.com"] },
      },
    } as never);
    expect(settings.deflection).toBeNull();
    expect(settings.searchDomains).toEqual([]);
  });

  it("drops a malformed email rather than enabling deflection", () => {
    const settings = assistantSettingsFromConfig({
      assistant: { supportEmail: "not-an-email" },
    } as never);
    expect(settings.deflection).toBeNull();
  });

  it("parses searchDomains from a flat string list", () => {
    const settings = assistantSettingsFromConfig({
      assistant: { searchDomains: ["*.example.com", "https://docs.example.com/api"] },
    } as never);
    expect(settings.searchDomains).toEqual([
      { host: "*.example.com", pathPrefix: "" },
      { host: "docs.example.com", pathPrefix: "/api" },
    ]);
  });
});

describe("docs.json assistant key", () => {
  it("is a known key and is not reported as ignored", () => {
    const { config, warnings } = parseDocsConfig({
      name: "Acme",
      assistant: { supportEmail: "support@acme.test", searchDomains: ["docs.acme.test"] },
    });
    expect(warnings).toEqual([]);
    expect(config.assistant?.supportEmail).toBe("support@acme.test");
  });
});

describe("parseSearchDomain", () => {
  it("accepts host, subdomain, wildcard, and path filters", () => {
    expect(parseSearchDomain("example.com")).toEqual({ host: "example.com", pathPrefix: "" });
    expect(parseSearchDomain("docs.example.com")).toEqual({
      host: "docs.example.com",
      pathPrefix: "",
    });
    expect(parseSearchDomain("*.example.com")).toEqual({ host: "*.example.com", pathPrefix: "" });
    expect(parseSearchDomain("docs.example.com/api")).toEqual({
      host: "docs.example.com",
      pathPrefix: "/api",
    });
    expect(parseSearchDomain("https://docs.example.com/api/")).toEqual({
      host: "docs.example.com",
      pathPrefix: "/api",
    });
  });

  it("refuses private hosts and credentials", () => {
    expect(parseSearchDomain("127.0.0.1")).toBeNull();
    expect(parseSearchDomain("localhost")).toBeNull();
    expect(parseSearchDomain("10.0.0.4")).toBeNull();
    expect(parseSearchDomain("https://user:pass@example.com")).toBeNull();
  });
});

describe("url allowlist", () => {
  const docs = parseSearchDomain("docs.example.com/api")!;
  const wild = parseSearchDomain("*.example.com")!;
  const apex = parseSearchDomain("example.com")!;

  it("matches host and path prefix", () => {
    expect(urlMatchesPattern(new URL("https://docs.example.com/api"), docs)).toBe(true);
    expect(urlMatchesPattern(new URL("https://docs.example.com/api/ref"), docs)).toBe(true);
    expect(urlMatchesPattern(new URL("https://docs.example.com/guides"), docs)).toBe(false);
    expect(urlMatchesPattern(new URL("https://example.com/api"), docs)).toBe(false);
  });

  it("treats example.com as that host only, and *.example.com as every subdomain", () => {
    expect(hostMatchesPattern("example.com", apex.host)).toBe(true);
    expect(hostMatchesPattern("docs.example.com", apex.host)).toBe(false);
    expect(hostMatchesPattern("docs.example.com", wild.host)).toBe(true);
    expect(hostMatchesPattern("example.com", wild.host)).toBe(true);
  });

  it("blocks loopback even when the hostname somehow matches", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(urlMatchesAny(new URL("http://127.0.0.1/"), [apex])).toBe(false);
  });
});

describe("isSupportEmail / deflectionMailto", () => {
  it("accepts ordinary addresses and rejects junk", () => {
    expect(isSupportEmail("support@example.com")).toBe(true);
    expect(isSupportEmail("not-an-email")).toBe(false);
    expect(isSupportEmail("")).toBe(false);
  });

  it("fills subject and optional question / page into the mailto", () => {
    const href = deflectionMailto("support@example.com", {
      question: "How do I reset a token?",
      pageUrl: "https://docs.example.com/auth",
    });
    expect(href.startsWith("mailto:support@example.com?")).toBe(true);
    const qs = new URL(href).searchParams;
    expect(qs.get("subject")).toBe("Documentation question");
    expect(qs.get("body")).toContain("How do I reset a token?");
    expect(qs.get("body")).toContain("https://docs.example.com/auth");
  });
});
