/**
 * HTTP-method → badge color, shared by the API endpoint header (`EndpointReference`) and the
 * left-nav method badges (`Sidebar`) so a `GET` reads the same green in both places. Pure data
 * (no server-only marker) so the client Sidebar can import it too.
 */
export const METHOD_COLORS: Record<string, string> = {
  GET: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  PATCH: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function methodColor(method: string): string {
  return (
    METHOD_COLORS[method.toUpperCase()] ??
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
  );
}

/** Text-only variant for the left-nav badge (hosted docs platforms renders the method as small colored
 *  text beside the operation, not a filled pill). */
const METHOD_TEXT: Record<string, string> = {
  GET: "text-green-600 dark:text-green-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-amber-600 dark:text-amber-400",
  DELETE: "text-red-600 dark:text-red-400",
};

export function methodTextColor(method: string): string {
  return METHOD_TEXT[method.toUpperCase()] ?? "text-zinc-500 dark:text-zinc-400";
}

/** Compact label for the narrow nav column (DELETE → DEL, OPTIONS → OPT). */
export function methodAbbrev(method: string): string {
  const m = method.toUpperCase();
  return m === "DELETE" ? "DEL" : m === "OPTIONS" ? "OPT" : m;
}
