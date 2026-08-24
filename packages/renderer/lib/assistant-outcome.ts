// Coarse "was the question answered?" classifier for the Assistant usage metrics. The
// assistant's system prompt tells the model to say plainly when the docs don't cover a
// question; a completed stream is otherwise counted as answered. Heuristic + English-only for
// now — a richer signal (e.g. a structured "no answer" tool result) is a follow-up. Stream
// errors are marked unanswered separately (see the assistant route's onError).
export function outcomeFromText(text: string): "answered" | "unanswered" {
  const t = text.trim();
  if (!t) return "unanswered";
  if (/\b(?:don't|do not|doesn't|does not|cannot|can't|couldn't|could not)\b[^.]*\b(?:have|find|contain|cover|include|know|answer|information)\b/i.test(t))
    return "unanswered";
  if (/\bno (?:information|documentation|answer|details?) (?:on|about|for)\b/i.test(t)) return "unanswered";
  return "answered";
}
