"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { reduceSearch } from "../lib/search-track";

type Hit = {
  title: string;
  section: string;
  heading: string;
  href: string;
  snippet: string;
};

/** The navbar search trigger + the Cmd/Ctrl-K command palette (SPEC.md §6). */
/**
 * `track` opts into search analytics. The hosted app passes it; the CLI doesn't, because
 * there's no `/api/search/track` endpoint in the CLI and firing beacons at a route that
 * 404s just litters the network panel of anyone previewing their docs.
 */
export function SearchButton({ site, track = false }: { site?: string; track?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute left-1/2 hidden w-full max-w-xs -translate-x-1/2 items-center gap-2 rounded-[var(--db-radius)] border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 md:flex"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="rounded border border-zinc-200 px-1.5 text-xs dark:border-zinc-700">⌘K</kbd>
      </button>
      {open && <SearchModal onClose={() => setOpen(false)} site={site} track={track} />}
    </>
  );
}

function SearchModal({
  onClose,
  site,
  track: trackEnabled,
}: {
  onClose: () => void;
  site?: string;
  track: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // The most-specific query of the search the user is currently refining. We log a
  // single "search" analytics event per *intent* (on settle's topic-switch, on a
  // result click, or on close) — not per keystroke. See lib/search-track.ts.
  const pendingRef = useRef("");

  const track = useCallback(
    (query: string) => {
      if (!trackEnabled) return;
      const trimmed = query.trim();
      if (!trimmed) return;
      const payload = JSON.stringify({ q: trimmed, site });
      // sendBeacon survives the navigation a result-click triggers; fall back to a
      // keepalive fetch where it's unavailable.
      try {
        if (navigator.sendBeacon?.("/api/search/track", new Blob([payload], { type: "application/json" })))
          return;
      } catch {
        // fall through
      }
      fetch("/api/search/track", {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    },
    [site, trackEnabled],
  );

  // Debounced query.
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      // Settle: fold this query into the current search session, committing the prior
      // one only if the user switched to an unrelated term (prefixes don't commit).
      const { pending, commit } = reduceSearch(pendingRef.current, q);
      pendingRef.current = pending;
      if (commit) track(commit);
      try {
        // Pass the tenant slug explicitly: in path mode (apex `/sites/{slug}`) this
        // request hits the apex host, so the route can't infer the tenant from the
        // Host header the way subdomain mode does. See requestContentSource().
        const siteParam = site ? `&site=${encodeURIComponent(site)}` : "";
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${siteParam}`, { signal: ctrl.signal });
        const data = await res.json();
        setHits(data.results ?? []);
        setActive(0);
      } catch {
        // aborted or failed — leave previous results
      }
    }, 160);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q, site, track]);

  // Closing the dialog ends the session: log the search still in flight (a click
  // clears `pendingRef` first, so it isn't double-counted). Read `track` via a ref so
  // this fires exactly once, on unmount.
  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(() => {
    return () => {
      if (pendingRef.current.trim()) trackRef.current(pendingRef.current);
    };
  }, []);

  const go = useCallback(
    (hit?: Hit) => {
      if (!hit) return;
      // The query that led to this result is the search that counts.
      track(q);
      pendingRef.current = "";
      router.push(hit.href);
      onClose();
    },
    [router, onClose, track, q],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    }
  };

  // Keep the active item in view.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-[var(--db-radius-lg)] border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Search className="h-5 w-5 shrink-0 text-zinc-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search documentation..."
            className="w-full bg-transparent py-3.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          <kbd className="rounded border border-zinc-200 px-1.5 py-0.5 text-xs text-zinc-400 dark:border-zinc-700">
            Esc
          </kbd>
        </div>

        {q.trim() && hits.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-zinc-400">
            No results for “{q}”
          </div>
        )}

        {hits.length > 0 && (
          <ul ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
            {hits.map((hit, i) => (
              <li key={`${hit.href}-${i}`}>
                <button
                  type="button"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                  className="block w-full rounded-[var(--db-radius)] px-3 py-2 text-left transition-colors data-[active=true]:bg-zinc-100 dark:data-[active=true]:bg-white/10"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {hit.heading || hit.title}
                    </span>
                    <span className="shrink-0 truncate text-xs text-zinc-400">
                      {[hit.section, hit.heading ? hit.title : null].filter(Boolean).join(" › ")}
                    </span>
                  </div>
                  {hit.snippet && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {hit.snippet}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
