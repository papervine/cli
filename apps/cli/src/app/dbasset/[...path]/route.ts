import { promises as fs, realpathSync } from "node:fs";
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

// Resolved through symlinks, once, because the containment check below compares against a
// realpath'd target. Without this the *root* could be the symlinked form while the target
// resolves to the real one — `/tmp` is a symlink to `/private/tmp` on macOS, so
// `papervine dev /tmp/docs` would fail every asset with a 403. Falls back to the lexical path
// if the dir doesn't exist yet; the reads will 404 anyway.
function resolveContentRoot() {
  const lexical = path.resolve(process.env.PAPERVINE_CONTENT ?? path.join(process.cwd(), "content"));
  try {
    return realpathSync(lexical);
  } catch {
    return lexical;
  }
}

const CONTENT_DIR = resolveContentRoot();

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

/** Is `target` inside `CONTENT_DIR`? Lexical check — see the realpath check below for why it
 *  isn't sufficient on its own. */
function isContained(target: string) {
  return target === CONTENT_DIR || target.startsWith(CONTENT_DIR + path.sep);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await params;
  const rel = parts.join("/");

  // Resolve under CONTENT_DIR and reject any traversal outside it.
  const target = path.normalize(path.join(CONTENT_DIR, rel));
  if (!isContained(target)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Serve only the asset types this route has a content type for. `middleware.ts` already
  // rewrites just those extensions, but `/dbasset/*` is reachable **directly** — the matcher
  // excludes it — so without this the route was an arbitrary-file reader for anything under the
  // previewed folder: `/dbasset/.env`, `/dbasset/id_rsa`, `/dbasset/.git/config`. Someone
  // running `papervine dev .` at a project root would have been serving their own secrets over
  // loopback. A docs previewer has no reason to hand out anything but assets, so the fallback
  // content type is gone and the allowlist is the same set middleware routes here.
  const ext = path.extname(target).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type) {
    return new Response("Not found", { status: 404 });
  }

  try {
    // Containment has to be re-checked on the *resolved* path. The lexical check above passes
    // for a path that stays inside the content dir on paper but crosses out through a symlink —
    // a repo containing `link -> /etc` made `/dbasset/link/passwd` readable, because readFile
    // follows the link. realpath resolves the whole chain, so the second check sees where the
    // read would actually land. It runs before the read, and a missing file throws here and
    // becomes the same 404 as any other miss.
    const real = await fs.realpath(target);
    if (!isContained(real)) {
      return new Response("Forbidden", { status: 403 });
    }
    const data = await fs.readFile(real);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "no-cache" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
