import { LucideIcon } from "../LucideIcon";

/**
 * Inline icon: `<Icon icon="flag" size={32} />` or `<Icon src="/images/logo.svg" />`.
 *
 * **Known fidelity limit.** Upstream resolves `icon` against Font Awesome, Lucide *and*
 * Tabler. We carry Lucide only, because bundling three icon libraries into a package whose
 * whole point is being light is a poor trade for a previewer. A name Lucide doesn't have
 * renders nothing rather than breaking the line, and `src` (URL or path) always works —
 * which is the escape hatch for an icon we can't resolve.
 *
 * `iconType` (Font Awesome's regular/solid/light/…) is accepted and ignored for the same
 * reason: Lucide has one weight.
 */
export function Icon({
  icon,
  src,
  color,
  size,
  className,
}: {
  icon?: string;
  src?: string;
  /** Font Awesome weight. Accepted for compatibility; Lucide has a single weight. */
  iconType?: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  const name = src || icon;
  if (!name) return null;
  return (
    <LucideIcon
      name={name}
      size={size}
      className={className ?? "inline-block align-[-0.125em]"}
      style={color ? { color } : undefined}
    />
  );
}
