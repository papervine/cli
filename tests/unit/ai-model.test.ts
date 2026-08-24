import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aiConfigured,
  aiModel,
  aiModelId,
  aiProviderOptions,
  aiProviderStatus,
  isLocalProvider,
  localBaseUrl,
  DEFAULT_AI_MODEL,
} from "@papervine/renderer/lib/ai-model";

const ENV_KEYS = [
  "PAPERVINE_AI_MODEL",
  "PAPERVINE_AI_MODEL_AUTOMATIONS",
  "AI_ROUTING",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "VERCEL",
  "AI_BASE_URL",
  "AI_LOCAL_API_KEY",
  "AI_LOCAL_REASONING",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("aiModelId", () => {
  it("defaults to the free-tier-validated model and honors PAPERVINE_AI_MODEL", () => {
    expect(aiModelId()).toBe(DEFAULT_AI_MODEL);
    process.env.PAPERVINE_AI_MODEL = "google/gemini-3.1-flash-lite";
    expect(aiModelId()).toBe("google/gemini-3.1-flash-lite");
  });

  it("automations take their own override, falling back to the global model", () => {
    expect(aiModelId("automations")).toBe(DEFAULT_AI_MODEL);
    process.env.PAPERVINE_AI_MODEL_AUTOMATIONS = "anthropic/claude-sonnet-4.6";
    expect(aiModelId("automations")).toBe("anthropic/claude-sonnet-4.6");
    // Other surfaces are unaffected by the automations override.
    expect(aiModelId()).toBe(DEFAULT_AI_MODEL);
    expect(aiModelId("assistant")).toBe(DEFAULT_AI_MODEL);
  });
});

describe("aiModel routing", () => {
  it("gateway routing (the default) resolves any provider-prefixed id", () => {
    expect(() => aiModel("anthropic/claude-haiku-4-5")).not.toThrow();
    expect(() => aiModel("google/gemini-3.1-flash-lite")).not.toThrow();
  });

  it("direct routing resolves supported providers and rejects unknown ones", () => {
    process.env.AI_ROUTING = "direct";
    expect(() => aiModel("anthropic/claude-haiku-4-5")).not.toThrow();
    expect(() => aiModel("mistral/mistral-large")).toThrow(/no direct SDK/);
  });
});

// Self-hosted inference (SPEC §18): Ollama / LM Studio / any OpenAI-compatible server.
describe("self-hosted (local) providers", () => {
  it("resolves known local prefixes to their default endpoints without a key", () => {
    expect(localBaseUrl("ollama")).toBe("http://localhost:11434/v1");
    expect(localBaseUrl("lmstudio")).toBe("http://localhost:1234/v1");
    expect(() => aiModel("ollama/qwen3")).not.toThrow();
    expect(aiProviderStatus("ollama/qwen3").ok).toBe(true);
  });

  it("takes the local path regardless of AI_ROUTING (the hosted gateway can't reach localhost)", () => {
    process.env.AI_ROUTING = "gateway";
    expect(() => aiModel("ollama/qwen3")).not.toThrow();
    process.env.AI_ROUTING = "direct";
    expect(() => aiModel("ollama/qwen3")).not.toThrow();
  });

  it("AI_BASE_URL overrides the default endpoint (vLLM, LiteLLM, a remote box…)", () => {
    process.env.AI_BASE_URL = "http://gpu-box.lan:8000/v1";
    expect(localBaseUrl("ollama")).toBe("http://gpu-box.lan:8000/v1");
    expect(localBaseUrl("local")).toBe("http://gpu-box.lan:8000/v1");
  });

  it("the generic local/ prefix requires AI_BASE_URL and says so", () => {
    expect(localBaseUrl("local")).toBeNull();
    const status = aiProviderStatus("local/whatever");
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.error).toContain("AI_BASE_URL");
    expect(() => aiModel("local/whatever")).toThrow(/AI_BASE_URL/);
  });

  it("targets /chat/completions, not OpenAI's Responses API", () => {
    // Regression: the provider's default is now the Responses API, which local
    // runtimes don't implement — Ollama rejects it with
    // `unknown input item type: "item_reference"`. Verified against a live Ollama
    // before this assertion existed; the spec/model id is the observable proxy.
    const m = aiModel("ollama/qwen3.5") as { modelId: string; specificationVersion: string };
    expect(m.modelId).toBe("qwen3.5");
    expect(m.specificationVersion).toBe("v3");
  });

  it("disables reasoning for local models, and only for them", () => {
    // Regression: local thinking models spend their whole response on reasoning —
    // measured 40s/3.8k reasoning chars vs 1.9s with it off, and the assistant's reply
    // came back EMPTY because the thinking crowded out the content.
    const local = aiProviderOptions("ollama/qwen3.5") as { openai?: { reasoningEffort?: string } };
    expect(local.openai?.reasoningEffort).toBe("none");

    const hosted = aiProviderOptions("anthropic/claude-haiku-4-5") as { openai?: unknown };
    expect(hosted.openai).toBeUndefined();

    // Opt back in for a machine that can afford it.
    process.env.AI_LOCAL_REASONING = "1";
    const optedIn = aiProviderOptions("ollama/qwen3.5") as { openai?: unknown };
    expect(optedIn.openai).toBeUndefined();
  });

  it("caches on every route: gateway-agnostic via caching:auto, direct via Anthropic markers", () => {
    // Through the gateway (default route), caching is provider-agnostic — `caching: 'auto'`
    // covers whatever model is picked (Gemini/OpenAI implicitly, Anthropic via auto-injected
    // markers), so we do NOT also hand-place Anthropic cache_control (that would double-mark).
    for (const id of [
      "anthropic/claude-haiku-4-5",
      "google/gemini-2.5-flash-lite",
      "openai/gpt-5-nano",
    ]) {
      const opts = aiProviderOptions(id) as {
        gateway?: { caching?: string };
        anthropic?: unknown;
      };
      expect(opts.gateway?.caching, id).toBe("auto");
      expect(opts.anthropic, id).toBeUndefined();
    }

    // Direct route (AI_ROUTING=direct): the gateway isn't in the path, so Anthropic's own
    // ephemeral cache_control carries caching, and there is no gateway key.
    process.env.AI_ROUTING = "direct";
    const direct = aiProviderOptions("anthropic/claude-haiku-4-5") as {
      gateway?: unknown;
      anthropic?: { cacheControl?: { type: string } };
    };
    expect(direct.gateway).toBeUndefined();
    expect(direct.anthropic?.cacheControl?.type).toBe("ephemeral");

    // Local models force the direct path regardless of AI_ROUTING (the hosted gateway can't
    // reach localhost), so they take the Anthropic-key branch, never the gateway key.
    process.env.AI_ROUTING = "gateway";
    const local = aiProviderOptions("ollama/qwen3.5") as {
      gateway?: unknown;
      anthropic?: { cacheControl?: { type: string } };
    };
    expect(local.gateway).toBeUndefined();
    expect(local.anthropic?.cacheControl?.type).toBe("ephemeral");
  });

  it("isLocalProvider distinguishes self-hosted prefixes from vendors", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("lmstudio")).toBe(true);
    expect(isLocalProvider("local")).toBe(true);
    expect(isLocalProvider("anthropic")).toBe(false);
  });
});

describe("aiProviderStatus", () => {
  it("gateway route accepts AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, or Vercel itself", () => {
    const missing = aiProviderStatus();
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("AI Gateway");

    process.env.AI_GATEWAY_API_KEY = "vck-test";
    expect(aiProviderStatus().ok).toBe(true);

    delete process.env.AI_GATEWAY_API_KEY;
    process.env.VERCEL_OIDC_TOKEN = "eyJ-test";
    expect(aiProviderStatus().ok).toBe(true);

    delete process.env.VERCEL_OIDC_TOKEN;
    process.env.VERCEL = "1";
    expect(aiProviderStatus().ok).toBe(true);
  });

  it("direct route requires the key matching the model's provider prefix", () => {
    process.env.AI_ROUTING = "direct";
    const missing = aiProviderStatus("anthropic/claude-haiku-4-5");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("ANTHROPIC_API_KEY");

    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(aiProviderStatus("anthropic/claude-haiku-4-5").ok).toBe(true);
    // Wrong provider's key doesn't satisfy a google model.
    const google = aiProviderStatus("google/gemini-3.1-flash-lite");
    expect(google.ok).toBe(false);
    if (!google.ok) expect(google.error).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
  });

  it("direct route with an unsupported provider reports it instead of throwing", () => {
    process.env.AI_ROUTING = "direct";
    const status = aiProviderStatus("mistral/mistral-large");
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.error).toContain("no direct SDK");
  });

  it("aiConfigured mirrors the status", () => {
    expect(aiConfigured()).toBe(false);
    process.env.AI_GATEWAY_API_KEY = "vck-test";
    expect(aiConfigured()).toBe(true);
  });
});