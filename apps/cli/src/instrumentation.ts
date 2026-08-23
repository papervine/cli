// Deliberately empty — and load-bearing precisely because it's empty.
//
// The CLI is built inside this monorepo, and Turbopack's project root resolves to the
// monorepo root (it must equal `outputFileTracingRoot`, which has to be the root for
// the workspace-linked renderer to be traced at all). With no instrumentation file of
// its own, the CLI build picked up the *hosted web app's* `src/instrumentation.ts`,
// which imports `sentry.server.config.ts` — compiling the control plane's error
// reporting, and its hardcoded production DSN, into `npx papervine`. Every CLI user's
// errors would have been reported into the hosted project from a public tarball.
//
// Declaring an empty `register()` here shadows that. The CLI has nothing to
// instrument: it is a local previewer with no telemetry, by design (SPEC §10.6).
//
// Do not delete this file because it "does nothing". Removing it silently re-adopts
// the monorepo's instrumentation — `tests/cli-package.mjs` is the backstop.
export async function register() {}
