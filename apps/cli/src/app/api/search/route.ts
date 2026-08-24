import { NextResponse, type NextRequest } from "next/server";
import { runSearch } from "@papervine/renderer/lib/search";

import { contentVersion } from "../../../lib/content-version";

/**
 * Full-text search for the previewed folder. `GET /api/search?q=…`
 *
 * Much simpler than the hosted app's equivalent, because none of what makes that one
 * complicated applies here: there is exactly one content source (the folder passed to
 * `papervine dev`, read straight from `PAPERVINE_CONTENT`), so there's no tenant to
 * resolve, and there are no readers, so there's no per-page access gate to apply.
 *
 * The index itself is an in-memory Orama index built from the same files the renderer
 * reads — no database, which is why search belongs in the CLI at all.
 */
export const dynamic = "force-dynamic";

const CONTENT_DIR = process.env.PAPERVINE_CONTENT ?? "content";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) {
    return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  // The whole point of this key: without one the engine rebuilds the index on every
  // request, re-reading and re-parsing every page in the repo for each keystroke. The
  // fingerprint is stat-only and changes whenever a page is saved, so repeat searches hit
  // a warm index while edits still show up. See lib/content-version.ts.
  const indexKey = await contentVersion(CONTENT_DIR);
  const results = await runSearch(q, { indexKey });

  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
