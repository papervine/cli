import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { searchDocs, readPage, listPages, searchApi, apiEnabled } from "./docs-tools";

/**
 * The docs site's MCP tool surface — one registration, two transports (SPEC §8.5).
 *
 * The capabilities themselves live in `docs-tools.ts` and are shared with the AI assistant.
 * What lives here is the MCP-specific half: tool names, the descriptions an external client
 * reads to decide what to call, and the argument schemas. That is the part that must not drift
 * between the hosted server and the CLI's — a tool description is a prompt, and two copies of a
 * prompt become two different products.
 *
 * The host supplies transport, per-request context and instrumentation; this supplies behaviour.
 * Same division as `assistant-run.ts`.
 *
 * `McpServer` is a **type-only** import, so it is erased at compile time and the renderer takes
 * no runtime dependency on the SDK for it. The app that actually serves MCP depends on the SDK
 * for its transport; every other consumer of the renderer is unaffected.
 */

/**
 * Per-request instrumentation, injected rather than imported.
 *
 * Analytics is a hosted concern: it needs a site row, a database and an agent identity, none of
 * which exist in the CLI. The bag is required even though each hook is optional — SPEC §10.6
 * records why for `AssistantHooks`: an optional bag lets a caller silently lose tracking with the
 * compiler none the wiser. The CLI passes `{}` to say "deliberately none".
 */
export type McpHooks = {
  /** A search was performed. */
  onSearch?: (query: string) => void;
  /** A page was read, by route path (leading slash, no extension). */
  onReadPage?: (path: string) => void;
};

/**
 * Wraps every tool call so the host can establish per-request context — the tenant's content
 * source, the reader's access predicate, the search index key. The CLI has one repo and one
 * implicit reader, so its `run` only pins the index key.
 */
export type McpRun = <T>(fn: () => Promise<T>) => Promise<T>;

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

/**
 * Register the docs tools on an MCP server.
 *
 * `search_api` is registered only when the site has an OpenAPI-backed reference — advertising a
 * tool whose only possible answer is "there is no API here" wastes a client's turn and reads as a
 * broken server.
 */
export async function registerDocsTools(
  server: McpServer,
  { run, hooks }: { run: McpRun; hooks: McpHooks },
): Promise<void> {
  server.registerTool(
    "search_docs",
    {
      description:
        "Full-text search this documentation. Returns the most relevant page sections with titles, hrefs (with #anchors), and snippets. Call this first for most questions.",
      inputSchema: { query: z.string().describe("Keywords to search for in the docs.") },
    },
    async ({ query }) => {
      hooks.onSearch?.(query);
      return run(async () => json(await searchDocs(query)));
    },
  );

  server.registerTool(
    "read_page",
    {
      description:
        "Read the full Markdown content of a documentation page by slug (e.g. 'guides/intro'). Use after search_docs when a snippet isn't enough.",
      inputSchema: { slug: z.string().describe("Page slug, with or without leading slash.") },
    },
    async ({ slug }) => {
      hooks.onReadPage?.("/" + slug.replace(/^\//, ""));
      return run(async () => json(await readPage(slug)));
    },
  );

  server.registerTool(
    "list_pages",
    {
      description: "List every documentation page (title + href) to understand what topics exist.",
      inputSchema: {},
    },
    async () => run(async () => json(await listPages())),
  );

  if (await run(() => apiEnabled())) {
    server.registerTool(
      "search_api",
      {
        description:
          "Search the API reference (OpenAPI operations) by keyword. Returns method, path, summary, and the endpoint page href.",
        inputSchema: { query: z.string().describe("Keywords, e.g. 'create user' or 'auth'.") },
      },
      async ({ query }) => run(async () => json(await searchApi(query))),
    );
  }
}
