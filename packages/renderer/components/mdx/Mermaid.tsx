"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders a Mermaid diagram. ```mermaid fences are swapped to `<Mermaid chart="…">` by
 * `remarkMermaid` (before Shiki touches them), so this receives the raw diagram source.
 *
 * Client-only: Mermaid runs in the browser and emits SVG. The library is heavy (~pulls in
 * d3 etc.), so we **dynamic-import it inside the effect** — it's fetched only on pages that
 * actually contain a diagram, never bundled into every docs page. Theme follows the *docs*
 * appearance (the `.dark` class on <html>, see appearance.ts); we re-render on toggle.
 *
 * `securityLevel: "loose"` is deliberately NOT used — we keep htmlLabels (so `<br/>`/`<i>`
 * in node labels render, matching hosted docs platforms) but `"antiscript"` strips any <script>, so a
 * diagram can't introduce a script-execution vector the rest of the renderer doesn't allow.
 *
 * A diagram that fails to parse degrades to its source in a <pre> — it never throws.
 */
export function Mermaid({ chart }: { chart: string }) {
  // useId yields React's ":r0:" form; strip colons so it's a valid Mermaid/DOM id.
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const draw = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "default",
          securityLevel: "antiscript",
        });
        const { svg } = await mermaid.render(`mmd-${id}`, chart);
        if (cancelled) return;
        setFailed(false);
        if (ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void draw();

    // Re-render when the docs light/dark appearance toggles (the `.dark` class on <html>).
    const observer = new MutationObserver(() => void draw());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [chart, id]);

  if (failed) {
    return (
      <pre className="my-4 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      aria-label="Diagram"
      className="mermaid my-5 flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
    />
  );
}
