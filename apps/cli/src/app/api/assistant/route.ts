import type { UIMessage } from "ai";
import { aiProviderStatus } from "@papervine/renderer/lib/ai-model";
import { runAssistantConversation } from "@papervine/renderer/lib/assistant-run";

import { contentVersion } from "../../../lib/content-version";

/**
 * The assistant, in the CLI (SPEC §8, §10.6).
 *
 * The same engine the hosted product runs — this is the third caller of
 * `runAssistantConversation`, and the differences are entirely in what it passes:
 *
 *  - `record: null`. There is no site row because there is no database. Every hosted-only step
 *    inside the run is already guarded on `record`, so analytics and metering are skipped
 *    structurally rather than by a flag.
 *  - `hooks: {}`. Required, so that omitting analytics/metering is a stated intent rather than
 *    something a caller can forget (which is how a hosted route would silently stop billing).
 *  - `billing: { allowed: true, metered: false }` — the shape the platform's own docs assistant
 *    has always used. Metering could not happen here anyway: charging needs an organization and
 *    a rate table, and this package ships no database driver.
 *  - `readerAccess`: allow-all. Reader auth is a hosted feature; a local preview has one reader.
 *
 * The model and key come from the environment (`ai-model.ts`), so a user brings their own —
 * an API key, or a local OpenAI-compatible server such as Ollama for a free offline assistant.
 */
export const dynamic = "force-dynamic";

const CONTENT_DIR = process.env.PAPERVINE_CONTENT ?? "content";

export async function POST(req: Request) {
  // No key configured is the normal case, not an error: the navbar hides the launcher, and this
  // only answers if someone posts here directly. The message is the one `ai-model` composes,
  // which names the variable that is missing.
  const provider = aiProviderStatus();
  if (!provider.ok) {
    return Response.json(
      { error: `${provider.error} — the assistant is unavailable.` },
      { status: 503 },
    );
  }

  const { messages, pageSlug } = (await req.json()) as {
    messages: UIMessage[];
    pageSlug?: string;
  };

  return runAssistantConversation({
    record: null,
    billing: { allowed: true, metered: false },
    messages,
    pageSlug,
    // The CLI serves exactly one folder, resolved from the environment at module load, so there
    // is no per-request tenant to scope to — the renderer's default source is already correct.
    contentSource: null,
    readerAccess: () => true,
    // The same fingerprint the search route uses, so the assistant's retrieval reuses the warm
    // index instead of rebuilding one per tool call.
    searchIndexKey: await contentVersion(CONTENT_DIR),
    hooks: {},
  });
}
