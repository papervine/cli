import { loadConfig } from "@papervine/renderer/lib/content";
import { buildNav } from "@papervine/renderer/lib/nav";
import { Navbar } from "@papervine/renderer/components/Navbar";
import { NavTabs } from "@papervine/renderer/components/NavTabs";
import { Sidebar } from "@papervine/renderer/components/Sidebar";
import { SearchButton } from "@papervine/renderer/components/SearchDialog";
import { Banner } from "@papervine/renderer/components/mdx/Banner";

// The docs chrome. Search works here — it's an in-memory index over the previewed
// folder, no backend required (see api/search/route.ts). The AI assistant is genuinely
// hosted-only (it needs a model provider), so Navbar simply renders without that slot.
//
// `track` is deliberately omitted: search analytics posts to an endpoint the CLI doesn't
// have, and a previewer shouldn't be firing beacons at a 404.
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const config = await loadConfig();
  const sections = await buildNav(config);

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
      <Navbar config={config} search={<SearchButton />} />
      <NavTabs sections={sections} />
      <div className="mx-auto flex max-w-7xl gap-8 pl-9 pr-6">
        <Sidebar sections={sections} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
