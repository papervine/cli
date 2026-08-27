import { serveLlmsTxt } from "../../lib/llms-handlers";

// llms-full.txt — the index plus every page's full Markdown body (SPEC §9.1).
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return serveLlmsTxt(req, true);
}
