import { servePageMd } from "../../../../lib/llms-handlers";

// A page's clean-Markdown twin, served at `<path>.md` (SPEC §9.1) — what every link in
// /llms.txt points at. The pretty URL is the one clients use; `middleware.ts` rewrites `*.md`
// here, because the route tree can't match on a file extension.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const slug = (path ?? []).join("/");
  // `/index.md` is how the index page's Markdown is addressed — its own slug is "".
  return servePageMd(req, slug === "index" ? "" : slug);
}
