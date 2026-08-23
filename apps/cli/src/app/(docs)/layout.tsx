import { loadConfig } from "@papervine/renderer/lib/content";
import { buildNav } from "@papervine/renderer/lib/nav";
import { Navbar } from "@papervine/renderer/components/Navbar";
import { NavTabs } from "@papervine/renderer/components/NavTabs";
import { Sidebar } from "@papervine/renderer/components/Sidebar";

// The docs chrome. The CLI is a local previewer, so it omits the hosted app's
// search palette and AI assistant (those are control-plane services) — Navbar
// simply renders without those slots.
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const config = await loadConfig();
  const sections = await buildNav(config);

  return (
    <>
      <Navbar config={config} />
      <NavTabs sections={sections} />
      <div className="mx-auto flex max-w-7xl gap-8 pl-9 pr-6">
        <Sidebar sections={sections} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
