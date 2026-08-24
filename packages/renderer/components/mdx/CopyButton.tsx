"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * The copy affordance on a code block (SPEC §5 lists it as a v1 parity target).
 *
 * Deliberately the *only* client component in the code-block path: the surrounding
 * `<CodeBlock>` is a server component that extracts the plain text and hands it here as a
 * prop, so the token-walking never reaches the browser. A docs page can carry a dozen fences
 * and this keeps the per-fence cost at one button.
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  // A pending reset has to be cancellable, or clicking twice in quick succession lets the
  // first timer clear the second click's feedback early.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    // `navigator.clipboard` is undefined on insecure origins (plain http on a LAN IP, which
    // is exactly how someone previews docs from a container host) and can reject when the
    // document isn't focused. Report the failure rather than silently doing nothing, so the
    // reader knows to select the text by hand.
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }, [text]);

  const label =
    state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C to copy" : "Copy";

  return (
    <button
      type="button"
      onClick={copy}
      // The label is the accessible name, and `aria-live` makes the state change audible to a
      // screen reader — a purely visual tick would announce nothing at all.
      aria-label={label}
      title={label}
      className={clsx(
        "absolute right-2 top-2 z-10 rounded-md border p-1.5 transition",
        // Visible on hover/focus at a pointer, always visible on touch (where there is no
        // hover) — `group-hover` alone would make it unreachable on a phone.
        "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
        "border-zinc-200 bg-white/90 text-zinc-500 backdrop-blur",
        "hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-400 dark:hover:text-zinc-100",
        className,
      )}
    >
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}
      </span>
      {state === "copied" ? <CheckIcon /> : <ClipboardIcon />}
    </button>
  );
}

// Inlined rather than pulled from lucide-react: these two are the whole icon need here, and a
// code block is the most-repeated element on a docs page.
function ClipboardIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-green-600 dark:text-green-400"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
