// Relative, not `@/…`: the root typecheck compiles this file without apps/cli's path aliases,
// so the alias resolves in `tsc -p apps/cli` and fails in `npm run typecheck`. Every sibling
// route imports its local lib the same way.
import { serveLlmsTxt } from "../../lib/llms-handlers";

// llms.txt index for AI clients (SPEC §9.1), for the folder being served. Content is read per
// request, so nothing here may be prerendered — same reason as the docs page.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return serveLlmsTxt(req, false);
}
