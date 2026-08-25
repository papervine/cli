import { loadConfig } from "@papervine/renderer/lib/content";
import { buildNav } from "@papervine/renderer/lib/nav";
import { Navbar } from "@papervine/renderer/components/Navbar";
import { NavTabs } from "@papervine/renderer/components/NavTabs";
import { Sidebar } from "@papervine/renderer/components/Sidebar";
import { SearchButton } from "@papervine/renderer/components/SearchDialog";
import { Banner } from "@papervine/renderer/components/mdx/Banner";
import { Assistant } from "@papervine/renderer/components/assistant/Assistant";
import { AskAssistantButton } from "@papervine/renderer/components/assistant/AskAssistantButton";
import { aiConfigured } from "@papervine/renderer/lib/ai-model";

// The docs chrome. Search works here — it's an in-memory index over the previewed folder, no
// backend required (see api/search/route.ts).
//
// The assistant is here too, and appears only when a model provider is configured: the SDKs ship
// with the package, so the only thing a user brings is a key (or a local OpenAI-compatible server
// such as Ollama, for a free offline assistant). Unconfigured is the ordinary case, not an error
// — the slot stays empty and the navbar renders exactly as it did before the assistant existed.
//
// `track` is deliberately omitted: search analytics posts to an endpoint the CLI doesn't
// have, and a previewer shouldn't be firing beacons at a 404.
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const config = await loadConfig();
  const sections = await buildNav(config);
  // Evaluated on the server, so an unset key never reaches the browser as a disabled button.
  const assistantOn = aiConfigured();

  return (
    <>
      {/* Above the navbar, so it reads as a site-wide notice rather than page content. */}
      {config.banner?.content && (
        <Banner
          content={config.banner.content}
          type={config.banner.type}
          dismissible={config.banner.dismissible}
          color={config.banner.color}
        />
      )}
      <Navbar
        config={config}
        search={<SearchButton />}
        assistant={assistantOn ? <AskAssistantButton /> : null}
      />
      <NavTabs sections={sections} />
      <div className="mx-auto flex max-w-[var(--db-shell-w)] gap-8 pl-9 pr-6">
        <Sidebar sections={sections} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      {/* The panel itself. The navbar button (and Cmd-I) dispatch an event it listens for, so
          it has to be mounted whenever the launcher is. */}
      {assistantOn && <Assistant />}
    </>
  );
}
