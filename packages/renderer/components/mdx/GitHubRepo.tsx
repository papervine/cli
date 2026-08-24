"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { GitFork, Star } from "lucide-react";

/**
 * Repository card: `<GitHub.Repo repo="owner/name" />`.
 *
 * The counts are fetched **client-side on mount**, deliberately. Doing it on the server
 * would put a third-party network call on the page render path — the one thing this
 * renderer is careful not to do — so a slow or rate-limited GitHub would slow down (or
 * fail) an unrelated docs page. Here it can't: the card renders immediately with the repo
 * name, and the numbers appear when they arrive.
 *
 * Unauthenticated GitHub API requests are rate-limited per IP (60/hour). When that limit is
 * hit the card keeps its name and link and simply omits the counts, which is why failure is
 * silent rather than an error state — a docs page shouldn't shout about someone else's quota.
 */
type Meta = { description?: string; stars?: number; forks?: number };

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

export function GitHubRepo({
  repo,
  variant = "inset",
  className,
}: {
  repo: string;
  variant?: "inset" | "flat";
  className?: string;
}) {
  // Accept either `owner/name` or a full URL, as documented.
  const slug = repo.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const [meta, setMeta] = useState<Meta>({});

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`https://api.github.com/repos/${slug}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setMeta({ description: d.description, stars: d.stargazers_count, forks: d.forks_count });
      })
      .catch(() => {
        // Offline, rate-limited, or a private repo — keep the card, drop the numbers.
      });
    return () => ctrl.abort();
  }, [slug]);

  return (
    <a
      href={`https://github.com/${slug}`}
      target="_blank"
      rel="noreferrer noopener"
      className={clsx(
        "card-link not-prose my-4 block rounded-[var(--db-radius)] border border-zinc-200 p-4 no-underline transition-colors hover:border-primary dark:border-zinc-800",
        variant === "inset" && "bg-zinc-50 dark:bg-zinc-900",
        className,
      )}
    >
      <span className="block font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {slug}
      </span>
      {meta.description && (
        <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">{meta.description}</span>
      )}
      {(meta.stars !== undefined || meta.forks !== undefined) && (
        <span className="mt-2 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          {meta.stars !== undefined && (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5" />
              {compact(meta.stars)}
            </span>
          )}
          {meta.forks !== undefined && (
            <span className="flex items-center gap-1">
              <GitFork className="h-3.5 w-3.5" />
              {compact(meta.forks)}
            </span>
          )}
        </span>
      )}
    </a>
  );
}

