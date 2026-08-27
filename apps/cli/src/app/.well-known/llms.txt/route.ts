import { serveLlmsTxt } from "../../../lib/llms-handlers";

// `/.well-known/llms.txt` — the RFC 8615 location some AI clients probe first. Same body as
// the root `/llms.txt`; two paths rather than a redirect, so a client that follows no
// redirects still gets the index.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return serveLlmsTxt(req, false);
}
