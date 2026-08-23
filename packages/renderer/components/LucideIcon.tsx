import type { ReactNode } from "react";
import { icons } from "lucide-react";

/**
 * Render a hosted docs platforms `icon` value. Usually a Lucide/FontAwesome name (kebab or
 * snake case), but can also be a JSX node or URL — strings resolve to a Lucide
 * component, anything else is passed through. Unknown names render nothing.
 */
export function LucideIcon({ name, className }: { name?: ReactNode; className?: string }) {
  if (!name) return null;
  if (typeof name !== "string") {
    return <span className={className}>{name}</span>;
  }
  const key = name
    .split(/[-_ ]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("") as keyof typeof icons;
  const Cmp = icons[key];
  return Cmp ? <Cmp className={className} /> : null;
}
