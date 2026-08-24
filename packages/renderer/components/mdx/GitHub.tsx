import type { ReactNode } from "react";

import { GitHubRepo } from "./GitHubRepo";

/**
 * The `<GitHub.Repo>` namespace.
 *
 * Deliberately split across two files. `GitHub.Repo` is a member expression, so `GitHub` has
 * to be an object carrying `.Repo` — but Next replaces the exports of a `"use client"` module
 * with client-reference proxies, and those don't carry arbitrary static properties. Attaching
 * `.Repo` inside the client module produced `undefined` at render time and MDX threw
 * "Expected component `GitHub.Repo` to be defined".
 *
 * So the card itself stays a client component (it fetches star counts on mount) in
 * GitHubRepo.tsx, and the namespace is assembled *here*, in a server module. The property
 * then holds a client reference, which React renders happily. `Tree` and `Color` avoid the
 * problem differently, by being server components outright.
 *
 * `GitHub` is a component rather than a bare object for two reasons: MDX's nested-component
 * type requires namespace entries to be renderable, and a bare `<GitHub>` should pass its
 * children through rather than fail.
 */
export function GitHub({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

GitHub.Repo = GitHubRepo;
