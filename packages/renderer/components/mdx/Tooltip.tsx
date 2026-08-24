import type { ReactNode } from "react";

/**
 * Inline term with a definition on hover: `<Tooltip tip="…">API</Tooltip>`.
 *
 * Built with CSS group-hover rather than a floating-UI library — no positioning engine, no
 * client JS, and it works in a server component. The cost is that the bubble can't flip
 * itself away from a viewport edge; it's centred above the term and clamped to a max width,
 * which is fine for the inline-glossary use this component is for.
 *
 * `focus-within` is included deliberately so keyboard users can reach it, since hover alone
 * would make the content unreachable without a pointer.
 */
export function Tooltip({
  tip,
  headline,
  cta,
  href,
  children,
}: {
  tip: string;
  headline?: string;
  cta?: string;
  href?: string;
  children?: ReactNode;
}) {
  return (
    <span className="group relative inline-block focus-within:z-20 hover:z-20">
      <span
        tabIndex={0}
        className="cursor-help underline decoration-dotted decoration-from-font underline-offset-2"
      >
        {children}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-xs -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs font-normal leading-relaxed text-zinc-700 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {headline && <span className="block font-semibold">{headline}</span>}
        <span className="block">{tip}</span>
        {cta && href && (
          <a href={href} className="card-link mt-1 block font-medium !text-primary">
            {cta}
          </a>
        )}
      </span>
    </span>
  );
}
