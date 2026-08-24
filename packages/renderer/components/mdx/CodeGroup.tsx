"use client";

import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import clsx from "clsx";

/**
 * Wraps multiple fenced code blocks in a tabbed view.
 *
 * Each tab's label comes from the fence's code title (```bash npm), which `remarkCodeTitles`
 * carries in on a `<CodeTitle data-code-title="npm">` wrapper — the serializer's highlighter
 * drops fence `meta`, so the label cannot be read off the `<pre>` itself. The `language`
 * attribute is the fallback for an untitled fence, which is why a group of untitled fences
 * reads "shellscript" three times over.
 */

type AnyProps = Record<string, unknown> & { children?: ReactNode };

/** Recursively search a rendered subtree for a code title, then the language attr. */
function findLabel(node: ReactNode): string | undefined {
  let language: string | undefined;

  const walk = (n: ReactNode): string | undefined => {
    if (!isValidElement(n)) return undefined;
    const props = n.props as AnyProps;
    // Our own code-title wrapper carries the label as an attribute value — the most direct
    // signal available, so it wins.
    const codeTitle = props["data-code-title"];
    if (typeof codeTitle === "string" && codeTitle) return codeTitle;
    if ("data-rehype-pretty-code-title" in props) {
      const text = Children.toArray(props.children).find((c) => typeof c === "string");
      if (typeof text === "string") return text;
    }
    const lang = props["language"] ?? props["data-language"];
    if (typeof lang === "string" && !language) language = lang;
    for (const child of Children.toArray(props.children)) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  };

  return walk(node) ?? language;
}

export function CodeGroup({ children }: { children: ReactNode }) {
  const blocks = Children.toArray(children).filter((c): c is ReactElement =>
    isValidElement(c),
  );
  const [active, setActive] = useState(0);

  if (blocks.length === 0) return null;

  return (
    <div className="my-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex gap-1 border-b border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-800 dark:bg-zinc-900">
        {blocks.map((b, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={clsx(
              "border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              i === active
                ? "border-primary text-primary"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            {findLabel(b) ?? `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      {/* Flatten the figure/pre styling and hide the per-block title (the tab shows it). */}
      <div className="[&_figure]:my-0 [&_pre]:my-0 [&_pre]:rounded-none [&_pre]:border-0 [&_[data-rehype-pretty-code-title]]:hidden [&_[data-code-title-bar]]:hidden [&_[data-code-title]]:my-0 [&_[data-code-title]]:rounded-none [&_[data-code-title]]:border-0">
        {blocks[active]}
      </div>
    </div>
  );
}
