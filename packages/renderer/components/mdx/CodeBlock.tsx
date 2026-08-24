import { Children, isValidElement, type ReactNode } from "react";

import { CopyButton } from "./CopyButton";

/**
 * The `pre` override: every fenced code block on every page, wrapped so it can carry a copy
 * button (SPEC §5's v1 parity target for code blocks, previously unbuilt).
 *
 * This is a **server** component. The plain text is recovered here, at render time, and handed
 * to `<CopyButton>` as a string prop — so the token walk below never ships to the browser and
 * the client cost of a fence stays at one small button.
 *
 * Why the walk works: the serializer highlights fences at compile time into
 * `<pre><code><span class="line"><span style=…>token</span>…</span>\n…</code></pre>`, with the
 * newlines as literal text nodes *between* the line spans. So concatenating every string in
 * document order reproduces the original source exactly — no separators to insert, and no
 * reliance on the DOM (a `textContent` read would need a client component and a ref).
 *
 * Note this deliberately does NOT try to reach for the raw fence source instead. That would
 * mean threading it through the serializer as a data attribute, and the compiled output is the
 * one representation guaranteed to match what the reader is actually looking at.
 */

/** Every string in `node`, in document order. */
function plainText(node: ReactNode): string {
  // Numbers are worth handling: MDX can emit one for an expression like {2}, and String()
  // on it is exactly right, whereas the isValidElement branch would silently drop it.
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement(node)) {
    const { children } = node.props as { children?: ReactNode };
    return Children.toArray(children).map(plainText).join("");
  }
  // null / undefined / boolean render nothing, so they contribute nothing.
  return "";
}

export function CodeBlock({ children, className, ...rest }: { children?: ReactNode; className?: string } & Record<string, unknown>) {
  // Shiki's trailing line span leaves a final newline that nobody wants pasted into a shell.
  const text = plainText(children).replace(/\n$/, "");

  return (
    // `group` is what the button's `group-hover` resolves against, and `relative` is what its
    // absolute positioning anchors to. The wrapper carries no visual style of its own so the
    // `<pre>`'s own margins and CodeGroup's `[&_pre]:…` descendant overrides keep working.
    <div className="group relative">
      {/* An empty fence has nothing to copy, and a button that copies "" is a bug, not a
          feature. */}
      {text.length > 0 && <CopyButton text={text} />}
      <pre className={className} {...rest}>
        {children}
      </pre>
    </div>
  );
}
