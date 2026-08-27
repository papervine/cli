"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronUp, Copy, Download, Sparkles } from "lucide-react";
import { openAssistant } from "./assistant/Assistant";

/**
 * The per-page actions control: a split button whose primary action copies the page as
 * Markdown, with a menu for the other two things a reader (or their AI tool) wants from a
 * docs page (SPEC §9.1).
 *
 * All three actions reuse machinery that already exists rather than adding a pipeline:
 *
 *  - **Copy page** fetches the page's own `.md` twin — the same URL `/llms.txt` links to —
 *    so there is exactly one definition of "this page as Markdown", and the clipboard can't
 *    drift from what an agent would fetch. It's a same-origin request, so a signed-in
 *    reader's session rides along and a gated page copies for the reader who can read it.
 *  - **Ask Assistant** dispatches the same event the navbar button and Cmd-I use. The
 *    assistant already sends the current pathname as `pageSlug`, so "about this page" needs
 *    no argument — the page context is inherent, not something this has to pass.
 *  - **Download PDF** opens the browser's print dialog, where "Save as PDF" produces the
 *    file. Same trade the whole-site export makes (SPEC §10.4): full renderer fidelity, no
 *    server-side PDF pipeline, and it works identically on the hosted product and the CLI.
 *    The print stylesheet below is what makes it a document instead of a screenshot of an
 *    app — before it, printing any docs page carried the sidebar and navbar into the paper.
 */

/**
 * Print rules for a docs page. Injected here rather than added to each app's `globals.css`
 * for two reasons: there are three of those (web app, CLI, and the tenant shell shares the
 * web app's), and Tailwind's purge doesn't see class names that only ever appear in a
 * `@media print` block. Self-contained, the way the export view's stylesheet is.
 *
 * `pv-no-print` is on the shared chrome components (Navbar, NavTabs, Sidebar, Banner,
 * TableOfContents) — the same components all three surfaces mount, so one class covers
 * every one of them.
 */
const PRINT_CSS = `
@media print {
  .pv-no-print { display: none !important; }
  /* The article is one column of a flex row whose other columns are now gone; let it use
     the full sheet instead of keeping its screen width. */
  .pv-article-row { display: block !important; min-height: 0 !important; padding: 0 !important; }
  .pv-article-col { max-width: none !important; }
  /* Links: a printed page can't be clicked, but a code-ish URL in the middle of a sentence
     is worse than nothing, so keep the underline and drop the color. */
  a { color: inherit !important; text-decoration: underline; }
  /* Don't split a fence, a table, or a callout across sheets. */
  pre, table, blockquote, figure { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  @page { margin: 1.6cm; }
}
`;

type Props = {
  /** URL of this page's Markdown twin (`<path>.md`), already carrying the site's base path. */
  mdHref: string;
  /** Whether the AI assistant is available on this surface; hides its item when it isn't. */
  assistant?: boolean;
};

type CopyState = "idle" | "copied" | "error";

export function PageActions({ mdHref, assistant = false }: Props) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const root = useRef<HTMLDivElement>(null);

  // Close on Escape or a click outside. Bound only while open, so a closed menu costs the
  // page no listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Revert the "Copied" confirmation. Keyed on the state itself so a second copy restarts
  // the timer instead of inheriting the first one's.
  useEffect(() => {
    if (copy === "idle") return;
    const t = setTimeout(() => setCopy("idle"), 2000);
    return () => clearTimeout(t);
  }, [copy]);

  const copyPage = useCallback(async () => {
    setOpen(false);
    try {
      const res = await fetch(mdHref, { headers: { accept: "text/markdown" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // `navigator.clipboard` needs a secure context, which a docs site served over plain
      // HTTP on a LAN address doesn't have. Falling back to opening the Markdown is more
      // useful than a dead button: the reader can still select and copy it.
      if (!navigator.clipboard?.writeText) {
        window.open(mdHref, "_blank", "noopener");
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      setCopy("error");
    }
  }, [mdHref]);

  const items = [
    {
      key: "copy",
      icon: Copy,
      title: "Copy page",
      detail: "Copy page as Markdown for LLMs",
      onSelect: copyPage,
    },
    ...(assistant
      ? [
          {
            key: "assistant",
            icon: Sparkles,
            title: "Ask Assistant",
            detail: "Ask questions about this page",
            onSelect: () => {
              setOpen(false);
              openAssistant();
            },
          },
        ]
      : []),
    {
      key: "pdf",
      icon: Download,
      title: "Download PDF",
      detail: "Download this page as a PDF",
      onSelect: () => {
        setOpen(false);
        // The dialog is modal and synchronous; close the menu first so it isn't captured in
        // the print preview.
        setTimeout(() => window.print(), 0);
      },
    },
  ];

  const label = copy === "copied" ? "Copied" : copy === "error" ? "Copy failed" : "Copy page";

  return (
    <div ref={root} className="pv-no-print not-prose relative flex justify-end">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="flex items-stretch rounded-lg border border-zinc-200 text-sm dark:border-zinc-800">
        <button
          type="button"
          onClick={copyPage}
          className="flex items-center gap-1.5 rounded-l-lg px-3 py-1.5 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          {copy === "copied" ? (
            <Check className="h-4 w-4 text-primary" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {label}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="More page actions"
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center rounded-r-lg border-l border-zinc-200 px-2 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronUp
            className={`h-4 w-4 transition-transform ${open ? "" : "rotate-180"}`}
          />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-[19rem] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          {items.map(({ key, icon: Icon, title, detail, onSelect }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={onSelect}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800">
                <Icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                  {title}
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
