import type { CSSProperties, ReactNode } from "react";
import { icons } from "lucide-react";

/**
 * Render a hosted docs platforms `icon` value. Usually a Lucide/FontAwesome name (kebab or
 * snake case), but can also be a JSX node or URL — strings resolve to a Lucide
 * component, anything else is passed through. Unknown names render nothing.
 */
export function LucideIcon({
  name,
  className,
  style,
  size,
}: {
  name?: ReactNode;
  className?: string;
  style?: CSSProperties;
  size?: number;
}) {
  if (!name) return null;
  if (typeof name !== "string") {
    return <span className={className}>{name}</span>;
  }
  // A URL or a path is an image, not a library name — that's how `<Icon src>` and an
  // `icon` pointing at a local SVG both arrive here.
  if (/^(https?:\/\/|\/)/.test(name) || /\.(svg|png|jpe?g|webp|gif)$/i.test(name)) {
    return (
      <img
        src={name}
        alt=""
        className={className}
        style={{ ...(size ? { width: size, height: size } : {}), ...style }}
      />
    );
  }
  const key = name
    .split(/[-_ ]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("") as keyof typeof icons;
  const Cmp = icons[key];
  if (!Cmp) return null;
  return <Cmp className={className} style={style} {...(size ? { size } : {})} />;
}
