import type { ReactNode } from "react";

/**
 * Split content between human readers and AI agents:
 * `<Visibility for="humans">` / `<Visibility for="agents">`.
 *
 * This renderer produces HTML for people, so `humans` renders and `agents` does not. The
 * agent half is dropped from the tree rather than hidden with CSS — content hidden in the
 * DOM would still be read by scrapers and screen readers, which is the opposite of what the
 * author asked for.
 *
 * An unrecognised `for` value renders the content. Silently swallowing a block because of a
 * typo'd attribute is a worse failure than showing it.
 */
export function Visibility({ for: audience, children }: { for?: string; children?: ReactNode }) {
  if (audience === "agents") return null;
  return <>{children}</>;
}
