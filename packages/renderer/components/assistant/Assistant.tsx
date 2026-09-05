"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";
import { Sparkles, X, Maximize2, Minimize2, ArrowUp, Paperclip } from "lucide-react";
import clsx from "clsx";
import { assistantInternalTarget } from "../../lib/assistant-link";
import {
  normalizeStarterQuestions,
  type AssistantPanelProps,
} from "../../lib/starter-questions";

/** Custom event other components dispatch to open the assistant (optionally with a query). */
export const OPEN_EVENT = "papervine:open-assistant";
export function openAssistant(query?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { query } }));
}

export function Assistant({ site, starterQuestions }: AssistantPanelProps) {
  const questions = useMemo(() => normalizeStarterQuestions(starterQuestions), [starterQuestions]);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/assistant" }),
  });

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // `site` scopes retrieval to this tenant in path mode (apex `/sites/{slug}`),
      // where the request can't carry the tenant in its Host header. See route.ts.
      sendMessage({ text: trimmed }, { body: { pageSlug: pathname, site } });
      setInput("");
    },
    [sendMessage, pathname, site],
  );

  // Markdown renderers for answers. The one that matters: a citation to a docs page must
  // **soft-navigate** within the docs SPA (like clicking the sidebar), not open a new tab —
  // and the panel stays open across it, so the conversation survives following a citation
  // (closing on every internal click would make the assistant useless for "show me, then
  // let me ask a follow-up"). Streamdown defaults every link to `target="_blank"`, so we
  // strip its `target`/`rel` (don't let them ride `…props`) and decide by origin: an
  // internal page link routes via `router.push`; only a genuinely external URL opens a new tab.
  const mdComponents = useMemo(() => {
    // Path mode serves the tenant under `/sites/{slug}` (vs. empty base on a subdomain), so a
    // root-absolute citation (`/quickstart`) needs that prefix to resolve to the right page.
    const base = site && pathname.startsWith(`/sites/${site}`) ? `/sites/${site}` : "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // The internal soft-nav target for an href, or null if it's external / a same-page anchor.
    const internalTarget = (href?: string): string | null =>
      assistantInternalTarget(href, base, origin);
    return {
      // Strip Streamdown's default target/rel (`_t`/`_r`) so they can't ride `…props`.
      a: ({ href, children, target: _t, rel: _r, ...props }: {
        href?: string;
        children?: ReactNode;
        target?: string;
        rel?: string;
      }) => {
        const to = internalTarget(href);
        const className =
          "text-inherit underline decoration-blue-500 underline-offset-2 hover:decoration-blue-400";
        if (to !== null) {
          return (
            <a
              href={href}
              onClick={(e) => {
                // Honor modifier/middle clicks (open-in-new-tab) — only hijack a plain click.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                router.push(to);
              }}
              className={className}
              {...props}
            >
              {children}
            </a>
          );
        }
        // Same-page anchor (no target) or external URL (new tab).
        const external = !!href && !href.startsWith("#");
        return (
          <a
            href={href}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            className={className}
            {...props}
          >
            {children}
          </a>
        );
      },
    };
  }, [router, pathname, site]);

  // Open triggers: navbar button / Cmd-I / ?assistant= deep link.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      if (q) ask(q);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);

    const url = new URL(window.location.href);
    const deepLink = url.searchParams.get("assistant");
    if (deepLink) {
      setOpen(true);
      ask(deepLink);
    }
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [ask]);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Focus the composer when the panel opens so the user can type straight away.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const busy = status === "submitted" || status === "streaming";
  const lastIsUser = messages[messages.length - 1]?.role === "user";

  return (
    <div
      className={clsx(
        "pv-no-print fixed bottom-0 right-0 top-0 z-50 flex flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950",
        expanded ? "w-full md:w-[48rem]" : "w-full sm:w-[28rem]",
      )}
    >
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
          <Sparkles className="h-5 w-5 text-primary" />
          Assistant
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <EmptyState questions={questions} onAsk={ask} />
        ) : (
          <div className="space-y-5">
            {messages.map((m) => (
              <Message key={m.id} role={m.role} parts={m.parts} components={mdComponents} />
            ))}
            {busy && lastIsUser && (
              <p className="text-sm text-zinc-400">Thinking…</p>
            )}
            {error && <AssistantError error={error} />}
          </div>
        )}
        {/* The empty state has its own branch above, so an error on the very first question —
            the most likely moment for one, since that is when a bad key shows up — would
            otherwise have nowhere to render. */}
        {messages.length === 0 && error && (
          <div className="mt-4">
            <AssistantError error={error} />
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) stop();
          else ask(input);
        }}
        className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <div className="flex items-end gap-2 rounded-xl border border-zinc-300 p-2 focus-within:border-primary dark:border-zinc-700">
          <button type="button" aria-label="Attach" disabled className="p-1.5 text-zinc-400" title="Attachments coming soon">
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder="Ask a question…"
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-zinc-400"
          />
          <button
            type="submit"
            aria-label={busy ? "Stop" : "Send"}
            className="rounded-lg bg-primary p-1.5 text-white disabled:opacity-40"
            disabled={!busy && !input.trim()}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

type Part = { type: string; text?: string; state?: string };

/**
 * Empty chat: the disclaimer, plus any configured starter questions.
 *
 * The questions are the author's — `docs.json` or the dashboard — and clicking one
 * is exactly "type this and send". They vanish once a message exists; a follow-up
 * is typed, not picked from the same list. The `starter-question-text` class is the
 * Mintlify CSS hook so a site that already styles that selector keeps working.
 */
function EmptyState({
  questions,
  onAsk,
}: {
  questions: string[];
  onAsk: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6">
      <p className="text-center text-sm text-zinc-400">
        Responses are generated using AI and may contain mistakes.
      </p>
      {questions.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          <p className="text-xs font-medium text-zinc-400">Suggestions</p>
          {questions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAsk(q)}
              className="starter-question-text rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-left text-sm text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A failed request, made visible.
 *
 * The AI SDK masks server errors as "An error occurred." unless the route opts out, so the text
 * here is often generic — which is why this also says where the real reason is. In the CLI that
 * is the terminal running `papervine dev`; the route logs the underlying error there.
 */
function AssistantError({ error }: { error: Error }) {
  const generic = /^an error occurred\.?$/i.test(error.message.trim());
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p className="m-0 font-medium">That question didn’t get an answer.</p>
      <p className="m-0 mt-1 opacity-90">
        {generic
          ? "The model request failed — check the terminal running your docs server for the reason."
          : error.message}
      </p>
    </div>
  );
}

function Message({
  role,
  parts,
  components,
}: {
  role: string;
  parts: Part[];
  components: ComponentProps<typeof Streamdown>["components"];
}) {
  if (role === "user") {
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-sm text-white">
        {text}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm text-zinc-800 dark:text-zinc-200">
      {parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          return (
            <Streamdown key={i} className="prose-assistant" components={components}>
              {part.text}
            </Streamdown>
          );
        }
        // Tool activity (searchDocs / readPage / …) shown as a subtle step.
        if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
          const name = part.type.replace(/^tool-/, "");
          if (part.state === "output-available" || part.state === "input-available") {
            return (
              <p key={i} className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Sparkles className="h-3 w-3" />
                {name === "searchDocs" || name === "searchApi"
                  ? "Searching the docs…"
                  : name === "readPage"
                    ? "Reading a page…"
                    : "Working…"}
              </p>
            );
          }
        }
        return null;
      })}
    </div>
  );
}
