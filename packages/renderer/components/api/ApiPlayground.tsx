"use client";

import { useState } from "react";
import clsx from "clsx";

/**
 * The page's read-only right rail (hosted docs platforms model): a request panel with language tabs
 * (cURL / JavaScript / Python) above a response panel with per-status tabs. Samples are
 * pre-highlighted server-side with Shiki (`highlightToHtml`) and handed in as HTML strings, so
 * the highlighter never ships to the client. The *interactive* playground is the opt-in modal
 * (`ApiTryItModal`) opened from the endpoint bar — this rail just shows the canonical samples.
 */

export type CodeSample = { label: string; html: string };
export type ResponseExample = { status: string; html: string };

const PANEL = "overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100";
const HEADER = "flex items-center gap-1 border-b border-zinc-800 px-2 py-1.5";
// Reset Shiki's <pre> (it carries its own margins; the panel supplies the background).
const CODE_BODY =
  "overflow-x-auto p-4 text-xs leading-relaxed [&_pre]:m-0 [&_pre]:!bg-transparent [&_code]:font-mono";

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}

export function ApiPlayground({
  samples,
  responses,
}: {
  samples: CodeSample[];
  responses: ResponseExample[];
}) {
  const [lang, setLang] = useState(0);
  const [respTab, setRespTab] = useState(0);

  return (
    <div className="space-y-4">
      <div className={PANEL}>
        <div className={HEADER}>
          {samples.map((s, i) => (
            <Tab key={s.label} active={i === lang} onClick={() => setLang(i)}>
              {s.label}
            </Tab>
          ))}
        </div>
        <div className={CODE_BODY} dangerouslySetInnerHTML={{ __html: samples[lang]?.html ?? "" }} />
      </div>

      <div className={PANEL}>
        <div className={HEADER}>
          {responses.map((r, i) => (
            <Tab key={r.status} active={i === respTab} onClick={() => setRespTab(i)}>
              {r.status}
            </Tab>
          ))}
        </div>
        <div
          className={CODE_BODY}
          dangerouslySetInnerHTML={{ __html: responses[respTab]?.html ?? "" }}
        />
      </div>
    </div>
  );
}
