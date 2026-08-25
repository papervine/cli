import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerDocsTools } from "@papervine/renderer/lib/mcp-tools";
import { withSearchIndexKey } from "@papervine/renderer/lib/search";

// Relative, not `@/…`: the root typecheck compiles this file without apps/cli's path aliases,
// so the alias resolves in `tsc -p apps/cli` and fails in `npm run typecheck`. Both sibling
// routes import it the same way.
import { contentVersion } from "../../lib/content-version";

/**
 * MCP server for the docs being served (SPEC §8.5) — the same four tools the hosted product
 * exposes, so an external client (Claude, Cursor, an agent) can search and read these docs live.
 * Point a client at `http://<host>:<port>/mcp`.
 *
 * Three things differ from the hosted route, and all three are absences:
 *
 *   - **No tenant resolution.** One process serves one repo, from `PAPERVINE_CONTENT`, so the
 *     renderer's default content source is already correct and there is nothing to resolve.
 *   - **No reader gate.** Reader auth is a hosted feature; these docs have one reader. The
 *     renderer's access predicate defaults to allow-all, so nothing needs saying.
 *   - **No analytics.** `hooks: {}` — required rather than optional, so "none" is a stated
 *     intent rather than something a caller can forget.
 *
 * The transport is the SDK's **Web-standard** Streamable HTTP transport, whose `handleRequest`
 * takes a `Request` and returns a `Response` — exactly a route handler's contract. That is why
 * this needs no `mcp-handler`: that package exists to bridge the SDK's Node-`IncomingMessage`
 * transport to a Fetch handler, and it declares `redis` as a runtime dependency which it imports
 * eagerly. Going straight to the Web-standard transport keeps a 4MB Redis client out of a
 * documentation previewer.
 */

// Content is read per request, so nothing here may be prerendered — same reason as the docs page.
export const dynamic = "force-dynamic";

const CONTENT_DIR = process.env.PAPERVINE_CONTENT ?? "content";

/**
 * A server per request. The transport is stateless (no `sessionIdGenerator`), which is what the
 * hosted route runs too, so there is no session to keep and nothing to leak between clients — and
 * it means a restart never orphans a session.
 */
async function handle(req: Request): Promise<Response> {
  const server = new McpServer(
    { name: "Papervine Docs", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // Pin the search index for this request's tool calls, so several searches in one conversation
  // reuse one built index instead of rebuilding per call. Keyed on a content fingerprint, so an
  // edit invalidates it.
  const indexKey = await contentVersion(CONTENT_DIR);
  await registerDocsTools(server, {
    run: (fn) => Promise.resolve(withSearchIndexKey(indexKey, fn)),
    hooks: {},
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Answer with JSON rather than opening an SSE stream. A docs tool call is a single
    // request/response with nothing to stream, and JSON is the shape every client handles.
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Per-request server: close it so the transport's listeners don't accumulate.
    await server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
