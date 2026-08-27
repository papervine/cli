import { NextResponse, type NextRequest } from "next/server";
import { setLlmsDiscoveryHeaders } from "@papervine/renderer/lib/llms-discovery";

// Static assets in a docs repo are referenced by root-absolute path (e.g.
// `/img/hero.png`) and live under the previewed folder (PAPERVINE_CONTENT), not
// `public/`. Rewrite those requests to the dbasset reader, which streams them
// from disk. Everything else falls through to the (docs) renderer. This is the
// CLI's only middleware — it has no tenant routing or control plane to gate.
const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

// Every page also serves its Markdown source at `<path>.md` — what /llms.txt links to, so an
// agent following a link gets prose instead of a React render. The route tree can't match on
// an extension, so the mapping is here: `/guides/auth.md` → `/api/page-md/guides/auth`.
// Checked BEFORE the asset rewrite, since `.md` is a page, not an asset.
const PAGE_MD_RE = /\.md$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PAGE_MD_RE.test(pathname) && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = `/api/page-md/${pathname.replace(/^\//, "").replace(PAGE_MD_RE, "")}`;
    return NextResponse.rewrite(url);
  }
  if (ASSET_RE.test(pathname) && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = `/dbasset${pathname}`;
    return NextResponse.rewrite(url);
  }
  // Advertise /llms.txt on the page response, so a client that landed on any page can find
  // the machine-readable index without guessing a path.
  const res = NextResponse.next();
  setLlmsDiscoveryHeaders(res.headers);
  return res;
}

export const config = {
  matcher: ["/((?!_next/|dbasset/).*)"],
};
