/**
 * Advertise the AI-discovery surfaces (SPEC §9.1) on a response, so a client that fetched
 * *any* page learns where the machine-readable index lives instead of having to guess a
 * path. `Link` is the standard mechanism; `X-Llms-Txt` is the convenience header AI clients
 * look for.
 *
 * Dependency-free on purpose: this is imported by the edge middleware (which attaches it to
 * docs page responses) as well as by the node route handlers, and the middleware bundle
 * can't pull in anything `server-only`.
 */
export const LLMS_LINK_HEADERS: readonly string[] = [
  '</llms.txt>; rel="alternate"; type="text/plain"; title="llms.txt"',
  '</llms-full.txt>; rel="alternate"; type="text/plain"; title="llms-full.txt"',
];

export const LLMS_TXT_HEADER = "x-llms-txt";
export const LLMS_TXT_PATH = "/llms.txt";

/** Attach the discovery headers to any Headers-like target. */
export function setLlmsDiscoveryHeaders(headers: {
  set(name: string, value: string): void;
  append(name: string, value: string): void;
}): void {
  headers.set(LLMS_TXT_HEADER, LLMS_TXT_PATH);
  for (const link of LLMS_LINK_HEADERS) headers.append("link", link);
}
