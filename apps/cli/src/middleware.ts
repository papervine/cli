import { NextResponse, type NextRequest } from "next/server";

// Static assets in a docs repo are referenced by root-absolute path (e.g.
// `/img/hero.png`) and live under the previewed folder (PAPERVINE_CONTENT), not
// `public/`. Rewrite those requests to the dbasset reader, which streams them
// from disk. Everything else falls through to the (docs) renderer. This is the
// CLI's only middleware — it has no tenant routing or control plane to gate.
const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (ASSET_RE.test(pathname) && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = `/dbasset${pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|dbasset/).*)"],
};
