import { gateway } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai, createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// The single place the AI model is chosen for every server-side AI call (public
// assistant, editor agent, automation runs). Everything is env-configurable — we are
// NOT hardcoded to any one provider or to the Vercel AI Gateway (SPEC §18).
//
//   PAPERVINE_AI_MODEL   "provider/model" id, e.g. "anthropic/claude-haiku-4-5",
//                        "google/gemini-3.1-flash-lite", "openai/gpt-5-nano".
//
//   PAPERVINE_AI_MODEL_AUTOMATIONS
//                        Optional override for automation runs. The global default is
//                        tuned for the high-volume assistant; automations *write docs*
//                        that land in Git, where a stronger writer earns its credits.
//
//   AI_ROUTING           "gateway" (default) → route through the Vercel AI Gateway (one
//                        key/OIDC, unified access to every provider + model).
//                        "direct"  → call the provider's own SDK directly with THAT
//                        provider's key (no Vercel in the middle) — full flexibility /
//                        no lock-in. Supported direct providers: anthropic, google, openai.
//
// This keeps the `ai` SDK's ergonomics while letting you use the gateway when convenient
// and go direct when you'd rather (own keys, other billing, avoiding gateway limits).
// Env is read per call, not at module load, so long-lived dev servers and unit tests
// see changes without a module-cache reset (the collab-secret lesson).

// Best model the gateway FREE tier reliably runs for our use case (see .env.example
// for the cheaper paid/BYOK alternatives).
export const DEFAULT_AI_MODEL = "anthropic/claude-haiku-4-5";

export type AiSurface = "assistant" | "editor" | "automations";

export function aiModelId(surface?: AiSurface): string {
  if (surface === "automations") {
    const override = process.env.PAPERVINE_AI_MODEL_AUTOMATIONS?.trim();
    if (override) return override;
  }
  return process.env.PAPERVINE_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

function routing(): "gateway" | "direct" {
  return process.env.AI_ROUTING === "direct" ? "direct" : "gateway";
}

// provider prefix → its direct SDK factory + the env var holding its key.
const DIRECT: Record<string, { make: (model: string) => LanguageModel; keyVar: string }> = {
  anthropic: { make: (m) => anthropic(m), keyVar: "ANTHROPIC_API_KEY" },
  google: { make: (m) => google(m), keyVar: "GOOGLE_GENERATIVE_AI_API_KEY" },
  openai: { make: (m) => openai(m), keyVar: "OPENAI_API_KEY" },
};

// Self-hosted inference (SPEC §18): any OpenAI-compatible server — Ollama, LM Studio,
// vLLM, llama.cpp, LiteLLM — reached by URL instead of by vendor SDK. The prefix picks
// a sensible default endpoint; AI_BASE_URL overrides it (and is required for the
// generic `local/` prefix). No API key needed: local servers don't authenticate, and
// the SDK requires a non-empty string, so we pass a placeholder.
//
// Built with `createOpenAI({ baseURL })` rather than @ai-sdk/openai-compatible: that
// package is the more tolerant fit in principle, but its current release targets
// provider spec v4 while our `ai` version speaks v3 — the type surfaces don't meet.
// Revisit when `ai` moves to v4. (Ollama and LM Studio both accept OpenAI's request
// shape, so this works today; a stricter server that rejects OpenAI-only params is the
// scenario that would justify the extra dependency.)
const LOCAL_DEFAULT_BASE_URLS: Record<string, string | null> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  local: null, // generic: AI_BASE_URL is mandatory
};

export function isLocalProvider(provider: string): boolean {
  return provider in LOCAL_DEFAULT_BASE_URLS;
}

/** The endpoint a local-provider model resolves to, or null when unconfigured. */
export function localBaseUrl(provider: string): string | null {
  const override = process.env.AI_BASE_URL?.trim();
  if (override) return override;
  return LOCAL_DEFAULT_BASE_URLS[provider] ?? null;
}

function splitModel(id: string): { provider: string; model: string } {
  const i = id.indexOf("/");
  return i === -1
    ? { provider: "", model: id }
    : { provider: id.slice(0, i), model: id.slice(i + 1) };
}

/** The resolved model for streamText/generateText — gateway, direct, or self-hosted. */
export function aiModel(id: string = aiModelId()): LanguageModel {
  const { provider, model } = splitModel(id);

  // Self-hosted endpoints are reachable only from our own process, never from the
  // hosted gateway — so they always take the direct path regardless of AI_ROUTING.
  if (isLocalProvider(provider)) {
    const baseURL = localBaseUrl(provider);
    if (!baseURL)
      throw new Error(
        `model "${id}" needs AI_BASE_URL (the URL of your OpenAI-compatible server, e.g. http://localhost:11434/v1).`,
      );
    // `.chat()`, NOT the provider's default: @ai-sdk/openai now defaults to OpenAI's
    // *Responses* API, which local runtimes don't implement — Ollama rejects it with
    // `unknown input item type: "item_reference"`. Every OpenAI-compatible server
    // implements /v1/chat/completions, which is what .chat() targets.
    return createOpenAI({
      name: provider,
      baseURL,
      apiKey: process.env.AI_LOCAL_API_KEY?.trim() || "local",
    }).chat(model);
  }

  if (routing() === "direct") {
    const direct = DIRECT[provider];
    if (!direct)
      throw new Error(
        `AI_ROUTING=direct but no direct SDK for provider '${provider}' ` +
          `(model=${id}). Supported: ${Object.keys(DIRECT).join(", ")}, ` +
          `${Object.keys(LOCAL_DEFAULT_BASE_URLS).join("/")} for a self-hosted endpoint, ` +
          `or use AI_ROUTING=gateway.`,
      );
    return direct.make(model);
  }
  // Gateway: pass the full "provider/model" string through the Vercel AI Gateway.
  return gateway(id);
}

/** Whether the chosen route can authenticate, with the reason when it can't — the
 *  automation task fails fast on this instead of a mid-run API error; HTTP routes 503
 *  so no-key envs (smoke/CI) degrade cleanly. */
export function aiProviderStatus(id: string = aiModelId()):
  | { ok: true }
  | { ok: false; error: string } {
  const { provider: prefix } = splitModel(id);
  // Self-hosted: "configured" means we know where to send the request. No key needed.
  if (isLocalProvider(prefix)) {
    return localBaseUrl(prefix)
      ? { ok: true }
      : {
          ok: false,
          error: `model "${id}" needs AI_BASE_URL (the URL of your OpenAI-compatible server, e.g. http://localhost:11434/v1)`,
        };
  }

  if (routing() === "direct") {
    const { provider } = splitModel(id);
    const direct = DIRECT[provider];
    if (!direct) {
      return {
        ok: false,
        error: `AI_ROUTING=direct but no direct SDK for provider '${provider}' (model=${id})`,
      };
    }
    return process.env[direct.keyVar]
      ? { ok: true }
      : { ok: false, error: `${direct.keyVar} is not configured (AI_ROUTING=direct, model=${id})` };
  }
  // Gateway: a key (dev/workers), a pulled OIDC token (local), or Vercel itself (OIDC).
  return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL
    ? { ok: true }
    : {
        ok: false,
        error: `model "${id}" routes via the AI Gateway but neither AI_GATEWAY_API_KEY nor VERCEL_OIDC_TOKEN is set`,
      };
}

/** Boolean form of aiProviderStatus for call sites that only gate. */
export function aiConfigured(): boolean {
  return aiProviderStatus().ok;
}

// Provider options every AI surface passes to generateText/streamText. Each key is
// namespaced by provider and ignored by the others, so one object serves every route.
export function aiProviderOptions(id: string = aiModelId()) {
  const { provider } = splitModel(id);
  // Is this model actually served through the Vercel AI Gateway? (Local providers force
  // the direct openai-compatible path regardless of AI_ROUTING — see aiModel.)
  const viaGateway = routing() === "gateway" && !isLocalProvider(provider);
  return {
    // Prompt caching: an agentic loop resends its whole conversation each step, so caching
    // the stable prefix bills those resends at a fraction of the input rate. Two routes,
    // mutually exclusive so Anthropic never gets both auto- AND hand-placed markers:
    //  - Through the gateway, `caching: 'auto'` is provider-agnostic — implicit for
    //    Google/OpenAI/DeepSeek, and the gateway auto-injects cache_control breakpoints for
    //    Anthropic (tail + stable prefix, purpose-built for tool-use loops). So caching keeps
    //    working whatever model PAPERVINE_AI_MODEL* points at — not just Anthropic.
    //  - Direct (AI_ROUTING=direct): the gateway isn't in the path, so set Anthropic's own
    //    ephemeral cache_control here. Ignored by every non-Anthropic direct route.
    ...(viaGateway
      ? { gateway: { caching: "auto" as const } }
      : { anthropic: { cacheControl: { type: "ephemeral" as const, ttl: "1h" as const } } }),
    // Reasoning OFF for local models. Modern open models (Qwen3, Gemma, DeepSeek-R1…)
    // think before answering, and on laptop hardware that dominates everything:
    // measured 40s with thinking vs 1.9s without for the same one-sentence answer —
    // 3.8k characters of reasoning to produce 212 characters of reply. Across an agent
    // loop's ~24 steps that's a ten-minute run instead of a usable one, and the
    // thinking can crowd out the reply entirely (an empty assistant answer). Set
    // AI_LOCAL_REASONING=1 to opt back in; hosted routes are unaffected either way.
    ...(isLocalProvider(provider) && !process.env.AI_LOCAL_REASONING?.trim()
      ? { openai: { reasoningEffort: "none" as const } }
      : {}),
  };
}
