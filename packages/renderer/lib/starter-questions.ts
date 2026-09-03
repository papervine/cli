/**
 * Starter questions — suggested prompts in the assistant's empty chat (SPEC §8).
 *
 * Two callers, one list:
 *  - `docs.json` `assistant.starterQuestions` (CLI / file-based sites)
 *  - the hosted dashboard, which stores the same strings and passes them as a prop
 *
 * The dashboard toggle is "are any suggestions on"; this module is only the list the
 * chat UI can safely render. A fourth question, a blank, or a stray number must not
 * break the panel — the schema is lenient (warn-don't-throw), so every caller runs
 * the value through `normalizeStarterQuestions` before display.
 */

/** Mintlify-compatible cap: the empty state shows at most three suggestions. */
export const MAX_STARTER_QUESTIONS = 3;

/** Suggested empty-state prompts. Always at most {@link MAX_STARTER_QUESTIONS} non-empty strings. */
export type StarterQuestions = string[];

/**
 * Props the in-docs assistant panel accepts. Centralized so the CLI layout and the
 * hosted tenant render pass the same shape — a dashboard-configured list and a
 * `docs.json` list are indistinguishable by the time they reach the component.
 */
export type AssistantPanelProps = {
  /** Tenant slug in path mode (`/sites/{slug}`); omitted on a subdomain / `papervine serve`. */
  site?: string;
  /**
   * Suggested prompts for the empty state. Untrusted on purpose: docs.json and a
   * dashboard payload both go through {@link normalizeStarterQuestions} inside the
   * component, so a caller that forgets to normalize still cannot render junk.
   */
  starterQuestions?: unknown;
};

/**
 * Coerce an untrusted config value into the list the chat UI can render.
 *
 * Trims, drops empties and non-strings, de-duplicates, and caps at three. Order is
 * preserved (the author's first three distinct questions win). A missing or
 * malformed value is an empty list — the panel then shows only the disclaimer,
 * which is the historical empty state.
 */
export function normalizeStarterQuestions(input: unknown): StarterQuestions {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: StarterQuestions = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const q = item.trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    out.push(q);
    if (out.length >= MAX_STARTER_QUESTIONS) break;
  }
  return out;
}
