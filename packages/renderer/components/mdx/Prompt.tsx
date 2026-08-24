"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { LucideIcon } from "../LucideIcon";

/**
 * A copyable AI prompt: `<Prompt description="…" actions={["copy", "cursor"]}>`.
 *
 * Copy needs the prompt as a *string*, but children arrive as React nodes, so the text is
 * flattened out of the tree rather than read from the DOM — reading from the DOM would pick
 * up whatever the markdown renderer added around it.
 *
 * The `cursor` action is a deep link (`cursor://anysphere.cursor-deeplink/prompt?text=…`).
 * It's rendered as a plain anchor, so a machine without Cursor installed simply does nothing
 * on click instead of erroring — there's no way to feature-detect a custom scheme.
 */
function flatten(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (typeof node === "object" && "props" in node) {
    return flatten((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

export function Prompt({
  description,
  icon,
  actions = ["copy"],
  children,
}: {
  description?: string;
  icon?: string;
  /** Font Awesome weight. Accepted for compatibility; Lucide has a single weight. */
  iconType?: string;
  actions?: string[];
  children?: ReactNode;
}) {
  const text = flatten(children).trim();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and unavailable on insecure origins; the prompt text
      // is visible on the page regardless, so a failed copy needs no error state.
    }
  };

  return (
    <div className="not-prose my-4 rounded-[var(--db-radius)] border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        {icon && <LucideIcon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />}
        <div className="min-w-0 flex-1">
          {description && (
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{description}</div>
          )}
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            {text}
          </pre>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {actions.includes("copy") && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {actions.includes("cursor") && (
          <a
            href={`cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(text)}`}
            className="card-link inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium !text-zinc-700 hover:border-primary dark:border-zinc-700 dark:bg-zinc-800 dark:!text-zinc-200"
          >
            Open in Cursor
          </a>
        )}
      </div>
    </div>
  );
}
