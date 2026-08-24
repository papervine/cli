import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { searchDocs, readPage, listPages, searchApi } from "./docs-tools";

/**
 * The assistant's tool layer (SPEC §8.1). Agentic retrieval: Claude decides which
 * of these to call, and how often, to answer a question. Each is a thin wrapper over
 * a capability the renderer already has — the same set a generated read-MCP would
 * expose (SPEC §8.5), so this is one implementation behind two transports.
 */
export const assistantTools: ToolSet = {
  searchDocs: tool({
    description:
      "Full-text search the documentation. Returns the most relevant page sections with titles, hrefs (with #anchors), and snippets. Call this first for most questions.",
    inputSchema: z.object({
      query: z.string().describe("Keywords to search for in the docs."),
    }),
    execute: ({ query }) => searchDocs(query),
  }),

  readPage: tool({
    description:
      "Read the full Markdown content of a documentation page by slug (e.g. 'guides/intro'). Use after searchDocs when a snippet isn't enough to answer.",
    inputSchema: z.object({
      slug: z.string().describe("Page slug, with or without leading slash."),
    }),
    execute: ({ slug }) => readPage(slug),
  }),

  listPages: tool({
    description:
      "List every documentation page (title + href) to understand what topics exist. Use when a search comes up empty or to orient.",
    inputSchema: z.object({}),
    execute: () => listPages(),
  }),

  searchApi: tool({
    description:
      "Search the API reference (OpenAPI operations) by keyword. Returns method, path, summary, and the endpoint page href.",
    inputSchema: z.object({
      query: z.string().describe("Keywords, e.g. 'create user' or 'auth'."),
    }),
    execute: ({ query }) => searchApi(query),
  }),
};
