import type { ReactNode } from "react";

/** Shared presentational row for a parameter/response field (hosted docs platforms style). */
export function ApiField({
  name,
  type,
  required,
  deprecated,
  defaultValue,
  children,
}: {
  name: string;
  type?: string;
  required?: boolean;
  deprecated?: boolean;
  defaultValue?: string;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-medium text-teal-600 dark:text-teal-400">
          {name}
        </span>
        {type && <span className="font-mono text-xs text-zinc-400">{type}</span>}
        {defaultValue !== undefined && (
          <span className="font-mono text-xs text-zinc-400">default:{defaultValue}</span>
        )}
        {required && <span className="text-xs font-medium text-red-500">required</span>}
        {deprecated && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            deprecated
          </span>
        )}
      </div>
      {children && (
        <div className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 [&>p]:my-0 [&>p+p]:mt-2">
          {children}
        </div>
      )}
    </div>
  );
}

// hosted docs platforms' `<ParamField path|query|header|body="name" type="…" required>`.
export function ParamField({
  path,
  query,
  header,
  body,
  name,
  type,
  required,
  deprecated,
  default: defaultValue,
  children,
}: {
  path?: string;
  query?: string;
  header?: string;
  body?: string;
  name?: string;
  type?: string;
  required?: boolean;
  deprecated?: boolean;
  default?: string;
  children?: ReactNode;
}) {
  const fieldName = path ?? query ?? header ?? body ?? name ?? "";
  return (
    <ApiField
      name={fieldName}
      type={type}
      required={required}
      deprecated={deprecated}
      defaultValue={defaultValue}
    >
      {children}
    </ApiField>
  );
}

// hosted docs platforms' `<ResponseField name="…" type="…" required>`.
export function ResponseField({
  name,
  type,
  required,
  deprecated,
  default: defaultValue,
  children,
}: {
  name: string;
  type?: string;
  required?: boolean;
  deprecated?: boolean;
  default?: string;
  children?: ReactNode;
}) {
  return (
    <ApiField
      name={name}
      type={type}
      required={required}
      deprecated={deprecated}
      defaultValue={defaultValue}
    >
      {children}
    </ApiField>
  );
}

/** Section of fields (Query Parameters, Response, …) — heading + divided rows, no box. */
export function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="not-prose my-8">
      <h3 className="m-0 mb-1 border-b border-zinc-200 pb-2 text-base font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}
