import type { ReactNode } from "react";
import { Info, AlertTriangle, Lightbulb, CheckCircle2, Pencil } from "lucide-react";
import clsx from "clsx";

type Variant = "note" | "info" | "warning" | "tip" | "check";

const VARIANTS: Record<
  Variant,
  { icon: typeof Info; className: string; iconClass: string }
> = {
  note: {
    icon: Pencil,
    className: "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50",
    iconClass: "text-zinc-500",
  },
  info: {
    icon: Info,
    className: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40",
    iconClass: "text-blue-500",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
    iconClass: "text-amber-500",
  },
  tip: {
    icon: Lightbulb,
    className: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
    iconClass: "text-emerald-500",
  },
  check: {
    icon: CheckCircle2,
    className: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40",
    iconClass: "text-green-500",
  },
};

function Callout({ variant, children }: { variant: Variant; children: ReactNode }) {
  const { icon: Icon, className, iconClass } = VARIANTS[variant];
  return (
    <div className={clsx("my-4 flex gap-3 rounded-xl border px-4 py-3 text-sm", className)}>
      <Icon className={clsx("mt-0.5 h-5 w-5 shrink-0", iconClass)} />
      <div className="[&>p]:my-0 [&>p+p]:mt-2 min-w-0">{children}</div>
    </div>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <Callout variant="note">{children}</Callout>;
export const Info_ = ({ children }: { children: ReactNode }) => <Callout variant="info">{children}</Callout>;
export const Warning = ({ children }: { children: ReactNode }) => <Callout variant="warning">{children}</Callout>;
export const Tip = ({ children }: { children: ReactNode }) => <Callout variant="tip">{children}</Callout>;
export const Check = ({ children }: { children: ReactNode }) => <Callout variant="check">{children}</Callout>;
