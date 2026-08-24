"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as React from "react";
import { run } from "@mdx-js/mdx";
import * as prodRuntime from "react/jsx-runtime";
import * as devRuntime from "react/jsx-dev-runtime";

import type { AssetDimensions } from "../lib/content";
import { applyTenantUrls, componentsForCompiled } from "../lib/mdx-runtime";

/**
 * The browser half of the MDX execution model (SPEC §10.6): pages that contain author *logic*
 * are evaluated here, in the visitor's browser, instead of on the server.
 *
 * This is what makes server-side RCE impossible by construction. An MDX expression is real
 * JavaScript; evaluating it in the process that holds `DATABASE_URL` is how
 * `{process.env.DATABASE_URL}` came to render a live connection string into a page. Here there
 * is no `process` and no filesystem to reach — the worst an author can do is act on their own
 * site in their own reader's browser, which is the same authority any script tag would have.
 *
 * It also restores the feature that made this necessary: hooks. Upstream's React-component
 * support hands authors `useState`/`useEffect`/… as free identifiers, which the compiled module
 * expects to find in scope. `run()` is `new AsyncFunction(code)(options)`, so `arguments[0]` is
 * the options object — a one-line prelude destructures the hooks out of it, and the author's
 * bare `useState` resolves. Without it the module throws `useState is not defined`, which is
 * precisely the 500 this model replaces.
 */

/** The hook surface an author may use without importing it. */
const HOOKS = {
  useState: React.useState,
  useEffect: React.useEffect,
  useRef: React.useRef,
  useCallback: React.useCallback,
  useMemo: React.useMemo,
  useContext: React.useContext,
  useReducer: React.useReducer,
} as const;

/**
 * Injected as a prelude to the compiled module. Bindings come off the options object rather than
 * `globalThis` so nothing leaks between pages and no global is mutated.
 */
const HOOK_PRELUDE = `const {${Object.keys(HOOKS).join(",")}} = arguments[0]._pvHooks;\n`;

/** A stable empty default, so omitting the prop does not allocate a new object per render. */
const NO_DIMENSIONS: AssetDimensions = {};

type ClientMdxProps = {
  compiledSource: string;
  /** Must match the flag the source was compiled with, or React 19 rejects the elements. */
  development: boolean;
  linkBase?: string;
  assetBase?: string;
  assetDimensions?: AssetDimensions;
};

export function ClientMdx({
  compiledSource,
  development,
  linkBase = "",
  assetBase = "",
  assetDimensions = NO_DIMENSIONS,
}: ClientMdxProps) {
  const [Content, setContent] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A page can be swapped under us by client navigation; ignore a resolution that lands after
  // the source it belongs to is no longer the one being rendered.
  const token = useRef(0);

  // `assetDimensions` is an object, and a default parameter would allocate a fresh one on every
  // render — a new identity each time, so the memo below would recompute, `components` would
  // change, and the effect that depends on it would re-run and `setContent` again. That is a
  // render loop waiting for a caller who passes an inline `{}`. Keyed on the *content* instead,
  // which is stable across renders regardless of how the prop is constructed.
  const dimensionsKey = JSON.stringify(assetDimensions);
  const components = useMemo(
    () => applyTenantUrls(componentsForCompiled(compiledSource), linkBase, assetBase, assetDimensions),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on dimensionsKey, see above
    [compiledSource, linkBase, assetBase, dimensionsKey],
  );

  useEffect(() => {
    const mine = ++token.current;
    let cancelled = false;
    setContent(null);
    setError(null);

    (async () => {
      try {
        // The compile happened on the server; this evaluates the result. Author code runs for
        // the first time here, in the browser.
        const mod = await run(HOOK_PRELUDE + compiledSource, {
          ...((development ? devRuntime : prodRuntime) as Parameters<typeof run>[1]),
          useMDXComponents: () => components,
          baseUrl: typeof window === "undefined" ? undefined : window.location.href,
          _pvHooks: HOOKS,
        } as Parameters<typeof run>[1]);
        if (cancelled || mine !== token.current) return;
        setContent(() => mod.default as React.ComponentType<Record<string, unknown>>);
      } catch (err) {
        if (cancelled || mine !== token.current) return;
        // Same contract as the server path: an unsupported feature degrades to a notice, it
        // never takes the page down.
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [compiledSource, components, development]);

  if (error) return <MdxNotice message={error} development={development} />;
  // Reserve nothing and render nothing while evaluating: the surrounding page (nav, header, and
  // every server-rendered page that has no author code) is already interactive.
  if (!Content) return null;

  // An author component that throws at *render* time would otherwise escape the try/catch above,
  // because React calls it after this function returns — the same trap that made a `useState`
  // page 500 on the server. The boundary is what keeps that a notice.
  return (
    <AuthorErrorBoundary development={development}>
      <Content components={components} />
    </AuthorErrorBoundary>
  );
}

function MdxNotice({ message, development }: { message: string; development: boolean }) {
  return (
    <div className="my-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="m-0 font-medium">This page couldn’t be fully rendered yet.</p>
      {development && <p className="m-0 mt-1 font-mono text-xs opacity-80">{message}</p>}
    </div>
  );
}

/**
 * Catches a throw from author code during render. A class component because that is still the
 * only way to implement `componentDidCatch`; it is deliberately tiny.
 */
class AuthorErrorBoundary extends React.Component<
  { development: boolean; children: React.ReactNode },
  { message: string | null }
> {
  constructor(props: { development: boolean; children: React.ReactNode }) {
    super(props);
    this.state = { message: null };
  }

  static getDerivedStateFromError(err: unknown) {
    return { message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown) {
    console.error("MDX author component failed:", err);
  }

  render() {
    if (this.state.message !== null) {
      return <MdxNotice message={this.state.message} development={this.props.development} />;
    }
    return this.props.children;
  }
}
