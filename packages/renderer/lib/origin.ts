/**
 * The absolute origin a request was made to — what Next's `metadataBase` needs so relative
 * `og:image` and canonical URLs expand into the absolute ones crawlers require (X silently
 * drops a card whose image URL isn't absolute).
 *
 * It has to be derived from the request, not from configuration, in BOTH apps that render
 * docs: the hosted platform answers on the marketing apex, every tenant subdomain and every
 * customer's own vanity domain, and a self-hosted `papervine serve` answers on whatever host
 * the operator put in front of it. A single configured base URL would stamp the wrong host
 * into `og:url` everywhere but one.
 *
 * Pure (no `next/headers`) so both apps share one definition of the fiddly protocol rules and
 * it can be unit-tested without a request.
 *
 * @param host  the `Host` header, or the forwarded vanity host on a custom domain
 * @param proto `x-forwarded-proto`, when a proxy set one
 */
export function originFromHost(host: string | null | undefined, proto?: string | null): string | null {
  const name = host?.trim();
  if (!name) return null;
  // Behind a proxy the forwarded protocol is authoritative (it may list several — the first
  // is the client-facing one). Otherwise infer: local development is the only place we serve
  // plaintext, and loopback / a `.localhost` suffix is exactly what identifies it.
  const forwarded = proto?.split(",")[0]?.trim();
  const local =
    /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|$)/.test(name) || /\.localhost(:|$)/.test(name);
  const scheme = forwarded || (local ? "http" : "https");
  try {
    return new URL(`${scheme}://${name}`).origin;
  } catch {
    return null; // a malformed Host must not 500 a render — metadataBase just stays unset
  }
}
