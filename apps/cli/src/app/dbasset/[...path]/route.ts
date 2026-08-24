import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";

/**
 * Static-asset handler for the local docs repo. Images (and other assets) in a
 * Papervine repo are referenced by absolute path from the repo root —
 * e.g. `![](/img/hero.png)`. Those files live under PAPERVINE_CONTENT (the folder
 * `papervine dev` points at), outside the app, so Next won't serve them from
 * `public/`. This route streams them from the content dir; `middleware.ts`
 * rewrites asset requests here.
 */
// Prebuilt at publish time, pointed at a folder only known at runtime — so this
// must never be prerendered or cached against the build machine's content dir.
// See the matching note in `(docs)/[[...slug]]/page.tsx`.
export const dynamic = "force-dynamic";

const CONTENT_DIR = path.resolve(
  process.env.PAPERVINE_CONTENT ?? path.join(process.cwd(), "content"),
);

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await params;
  const rel = parts.join("/");

  // Resolve under CONTENT_DIR and reject any traversal outside it.
  const target = path.normalize(path.join(CONTENT_DIR, rel));
  if (target !== CONTENT_DIR && !target.startsWith(CONTENT_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const data = await fs.readFile(target);
    const type =
      CONTENT_TYPES[path.extname(target).toLowerCase()] ??
      "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "no-cache" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
