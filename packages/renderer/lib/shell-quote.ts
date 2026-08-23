/**
 * Single-quote a value for a POSIX shell.
 *
 * The API reference's cURL samples exist to be copied into a terminal, so any value that reaches
 * one has to survive the trip: an unquoted `&` backgrounds the command, a `<` redirects, and a
 * bare apostrophe — `/users/o'brien`, or a password containing one — leaves an unbalanced quote
 * that makes the shell hang waiting for the rest of the string. `encodeURIComponent` doesn't help:
 * it leaves `'` alone.
 *
 * Inside single quotes the shell treats everything literally, so the only escape needed is for the
 * quote itself: end the string, add an escaped quote, start a new one (`'\''`).
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
