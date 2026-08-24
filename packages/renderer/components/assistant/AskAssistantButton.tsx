"use client";

import { Sparkles } from "lucide-react";
import { openAssistant } from "./Assistant";

/** Navbar "Ask Assistant" trigger (SPEC §8.3). */
export function AskAssistantButton() {
  return (
    <button
      onClick={() => openAssistant()}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      <Sparkles className="h-4 w-4 text-primary" />
      Ask Assistant
    </button>
  );
}
