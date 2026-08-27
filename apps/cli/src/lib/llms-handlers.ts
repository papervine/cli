import { renderLlmsTxt } from "@papervine/renderer/lib/llms";
import { setLlmsDiscoveryHeaders } from "@papervine/renderer/lib/llms-discovery";
import { renderPageMarkdown } from "@papervine/renderer/lib/page-md";

/**
 * The AI-discovery surfaces for the folder being served (SPEC §9.1): `/llms.txt`,
 * `/llms-full.txt`, and every page's Markdown twin at `<path>.md`. Shared by the five thin
 * route files so the headers and the origin derivation have one definition.
 *
 * Everything that makes the hosted versions complicated is absent here, the same three
 * absences the MCP route documents: one process serves one repo from `PAPERVINE_CONTENT`, so
 * the renderer's default content source is already correct and there is no tenant to resolve;
 * these docs have one reader, so there is no access gate (the renderer's predicate defaults to
 * allow-all); and there are no analytics.
 */

/**
 * The origin to write into the generated links. A previewed site is reached over plain HTTP on
 * a local port far more often than not, so unlike the hosted route — which defaults to https
 * behind a proxy — this trusts `x-forwarded-proto` when present and otherwise assumes http.
 */
function originOf(req: Request): string {
  const host = req.headers.get("host");
  if (!host) return "";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function serveLlmsTxt(req: Request, full: boolean): Promise<Response> {
  let body: string;
  try {
    body = await renderLlmsTxt(originOf(req), full);
  } catch {
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
  setLlmsDiscoveryHeaders(headers);
  return new Response(body, { headers });
}

export async function servePageMd(req: Request, slug: string): Promise<Response> {
  let body: string | null;
  try {
    body = await renderPageMarkdown(slug);
  } catch {
    body = null;
  }
  if (body === null) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const headers = new Headers({ "content-type": "text/markdown; charset=utf-8" });
  setLlmsDiscoveryHeaders(headers);
  headers.append("link", `<${originOf(req)}${slug === "" ? "/" : `/${slug}`}>; rel="canonical"`);
  return new Response(body, { headers });
}
