import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PageAccess } from "./nav";

/**
 * The per-request reader-access predicate, carried out of band.
 *
 * Every surface that exposes page *content* — Cmd-K search, the assistant's retrieval, MCP —
 * has to apply the same gate the renderer applies to navigation, or a reader can pull content
 * out of a page they cannot open (SPEC §11.2). Rather than thread a predicate through every
 * signature, it rides an AsyncLocalStorage the way the content source does, so it reaches even
 * the streamed tool calls of an agentic run.
 *
 * This lives in the renderer rather than the web app because the *consumers* do: `docs-tools`
 * and the assistant are shared with the CLI now. What stays control-plane is only how the
 * predicate is derived from a site record and a reader cookie — see `accessForRecord` in the
 * app, which builds one and hands it here.
 *
 * The default is ALLOW_ALL, so anything that never sets it — the apex, `papervine dev`, a site
 * with reader auth off — behaves exactly as if this did not exist.
 */
const ALLOW_ALL: PageAccess = () => true;

const accessContext = new AsyncLocalStorage<PageAccess>();

/** The current request's access predicate, or ALLOW_ALL when none is set. */
export function currentPageAccess(): PageAccess {
  return accessContext.getStore() ?? ALLOW_ALL;
}

/** Run `fn` with `access` as the current predicate (nest inside `contentContext.run`). */
export function withReaderAccess<T>(access: PageAccess, fn: () => Promise<T> | T): Promise<T> | T {
  return accessContext.run(access, fn);
}
