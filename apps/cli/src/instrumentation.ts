// This file exists for two unrelated reasons. The first is why it must never be deleted.
//
// 1. IT SHADOWS THE MONOREPO'S INSTRUMENTATION — and that is load-bearing.
//
//    The CLI is built inside this monorepo, and Turbopack's project root resolves to the
//    monorepo root (it must equal `outputFileTracingRoot`, which has to be the root for the
//    workspace-linked renderer to be traced at all). With no instrumentation file of its own,
//    the CLI build picked up the *hosted web app's* `src/instrumentation.ts`, which imports
//    `sentry.server.config.ts` — compiling the control plane's error reporting, and its
//    hardcoded production DSN, into `npx papervine`. Every CLI user's errors would have been
//    reported into the hosted project from a public tarball.
//
//    Declaring `register()` here shadows that. The CLI has no telemetry, by design (SPEC §10.6).
//    Do not delete this file, and do not import anything from the web app into it.
//    `tests/cli-package.mjs` is the backstop.
//
// 2. It warms the search index, which is the one thing worth doing at startup.
//
//    The index is built lazily on the first query and cached against a content fingerprint.
//    Measured on a 500-page repo: the first search costs ~270ms, later ones ~17ms — and because
//    saving a file changes the fingerprint, the first search *after every edit* costs ~210ms
//    again. In a previewer, editing is the whole activity, so that cost recurs all day rather
//    than being a one-off. Warming at startup alone would only fix the very first search.
//
//    So: build once now, then rebuild whenever the previewed files change. Both happen off the
//    request path, so the reader's first keystroke hits a built index either way.

/** How often to check whether the previewed files changed. */
const POLL_MS = 2_000;

export async function register() {
  // Only the Node server has the index; the edge runtime never serves /api/search.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Set by `bin/papervine.mjs` before spawning the server. Without it there is no folder to
  // index, and this is a no-op — which is also the case in any non-CLI build of this app.
  const dir = process.env.PAPERVINE_CONTENT;
  if (!dir) return;

  const [{ warmSearchIndex }, { contentVersion }] = await Promise.all([
    import("@papervine/renderer/lib/search"),
    import("./lib/content-version"),
  ]);

  let lastKey: string | null = null;

  const sync = async () => {
    try {
      // Stat-only, and deliberately cheap for exactly this reason — see content-version.ts.
      const key = await contentVersion(dir);
      if (key === lastKey) return;
      lastKey = key;
      await warmSearchIndex(key);
    } catch {
      // Warming is an optimisation. If it fails the lazy path still builds on demand, and a
      // previewer must not fall over because a file moved mid-walk.
    }
  };

  await sync();

  // `unref` so this timer never holds the process open: Ctrl-C should exit immediately, not
  // wait out a poll. Without it the CLI would hang on shutdown for up to POLL_MS.
  const timer = setInterval(sync, POLL_MS);
  timer.unref?.();
}
