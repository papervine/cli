import { serveLlmsTxt } from "../../../lib/llms-handlers";

// `/.well-known/llms-full.txt` — the well-known alias for the whole-corpus variant.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return serveLlmsTxt(req, true);
}
