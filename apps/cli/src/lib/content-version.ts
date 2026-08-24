import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * A cheap fingerprint of the previewed docs folder, used as the search index's version key.
 *
 * This exists purely for speed, and the speed difference is large. The search engine caches
 * its Orama index per version key, but falls back to rebuilding **per request** when there
 * is no key — which is what `papervine dev` used to get, because a local folder has no
 * commit sha to key on. Rebuilding means re-reading and re-parsing every page in the repo
 * on every keystroke; the hosted app hit exactly that and it was reported as "search got
 * slow".
 *
 * So we derive a key from file metadata instead of file contents: walk the page files and
 * combine their count with the newest mtime. That's `stat` only — no reads, no parsing —
 * and it stays correct for a previewer, because saving any page moves the newest mtime and
 * therefore the key, which invalidates the index and picks the edit up on the next search.
 *
 * Cost on a ~100-page repo is around a millisecond, against ~100ms+ to rebuild. Renaming a
 * file changes the count; editing one changes the mtime. The theoretical miss — swapping a
 * file for another with an identical mtime and no count change — needs deliberate effort
 * with `touch`, and the cost of being wrong is a stale search result until the next edit.
 */
const PAGE_EXTS = [".mdx", ".md"];

export async function contentVersion(dir: string): Promise<string> {
  let count = 0;
  let newest = 0;

  async function walk(current: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return; // unreadable dir — nothing to fingerprint
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (PAGE_EXTS.some((ext) => entry.name.endsWith(ext)) || entry.name === "docs.json") {
        count++;
        try {
          const { mtimeMs } = await fs.stat(full);
          if (mtimeMs > newest) newest = mtimeMs;
        } catch {
          // vanished between readdir and stat — ignore
        }
      }
    }
  }

  await walk(path.resolve(dir));
  return `${count}:${Math.round(newest)}`;
}
