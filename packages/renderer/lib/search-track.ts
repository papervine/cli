/**
 * Search-analytics intent tracking (SPEC §10.1).
 *
 * The search box fetches results on a short (160ms) keystroke debounce — good for
 * UX, wrong for analytics. Logging a "search" event per fetched query counts every
 * prefix the user types through (`a`, `an`, `ana`, … `analytics` ≈ 8 events for one
 * search), because real typing is slower than 160ms. We instead log on *settle* and
 * collapse a refinement chain to the single query the user actually meant.
 *
 * `reduceSearch` is the pure core: given the query we're currently accumulating and a
 * newly-settled query, it decides whether the previous one should be committed (logged)
 * and what we carry forward. A query that extends or trims the pending one is the same
 * evolving search; a query sharing no prefix is a new search, which commits the old one.
 */
export function reduceSearch(
  pending: string,
  next: string,
): { pending: string; commit: string | null } {
  const a = pending.trim();
  const b = next.trim();
  // Cleared/whitespace: hold the pending query so a later close still logs it.
  if (!b) return { pending, commit: null };
  // First meaningful query of a session — nothing to commit yet.
  if (!a) return { pending: next, commit: null };
  // Same evolving search (typing forward or backspacing) — keep the more specific form.
  if (a.startsWith(b) || b.startsWith(a)) {
    return { pending: b.length >= a.length ? next : pending, commit: null };
  }
  // Topic switch — the previous search is done; log it and start fresh.
  return { pending: next, commit: pending };
}
