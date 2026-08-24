// Terminal styling for the CLI, in the Papervine palette.
//
// Two rules shape everything here:
//
//  1. **Colour is opt-out, and detected — never assumed.** `#7C3AED` needs a truecolor
//     terminal; on a 256-colour one the escape is ignored or renders as garbage, so each tier
//     gets its own escape and an unsupported terminal gets none. `NO_COLOR` is honoured
//     (no-color.org), as is `FORCE_COLOR` for the case where someone *does* want colour through
//     a pipe.
//  2. **Decoration is for humans at a terminal.** Piped or redirected output is plain, so
//     `papervine --help | grep` and anything reading us programmatically get clean text
//     instead of escape codes. Same reasoning as the scaffold prompt in papervine.mjs: the
//     pretty path is for the interactive case and must never be the only path.

const PALETTE = {
  // docs.json `colors` — the same values the rendered site uses, so the CLI and the docs it
  // serves are visibly the same product.
  brand: { rgb: [124, 58, 237], ansi256: 99 }, // #7C3AED
  brandLight: { rgb: [167, 139, 250], ansi256: 141 }, // #A78BFA
  red: { rgb: [239, 68, 68], ansi256: 203 },
  green: { rgb: [34, 197, 94], ansi256: 78 },
  yellow: { rgb: [234, 179, 8], ansi256: 220 },
};

/** "truecolor" | "256" | "none" — what this terminal can actually render. */
function colorLevel() {
  const env = process.env;
  // The documented way to turn colour off, regardless of everything below.
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";
  if (env.FORCE_COLOR === "0") return "none";
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0";
  // A pipe or a file gets plain text unless explicitly forced.
  if (!forced && !process.stdout.isTTY) return "none";
  if (env.TERM === "dumb") return "none";
  if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return "truecolor";
  // Most modern emulators are truecolor even without advertising COLORTERM; 256 is the safe
  // assumption when we can't tell, and the palette has a near-match for every colour.
  return "256";
}

const LEVEL = colorLevel();
const on = LEVEL !== "none";

function paint(name) {
  return (s) => {
    if (!on) return String(s);
    const c = PALETTE[name];
    const code =
      LEVEL === "truecolor"
        ? `38;2;${c.rgb[0]};${c.rgb[1]};${c.rgb[2]}`
        : `38;5;${c.ansi256}`;
    return `\x1b[${code}m${s}\x1b[39m`;
  };
}

export const brand = paint("brand");
export const brandLight = paint("brandLight");
export const red = paint("red");
export const green = paint("green");
export const yellow = paint("yellow");
export const bold = (s) => (on ? `\x1b[1m${s}\x1b[22m` : String(s));
export const dim = (s) => (on ? `\x1b[2m${s}\x1b[22m` : String(s));

/** Are we decorating at all? Callers use this to pick a layout, not just a colour. */
export const styled = on;

/**
 * Lay out `[label, description]` rows with the descriptions in one column.
 *
 * Width is measured on the *undecorated* label, because escape codes have no display width —
 * padding a coloured string by `String.length` puts the codes in the count and misaligns every
 * row by however many bytes the colour took.
 */
export function rows(entries, { indent = "    ", gap = 2 } = {}) {
  const width = Math.max(0, ...entries.map(([label]) => label.length));
  return entries
    .map(([label, description, paintLabel = brand]) =>
      `${indent}${paintLabel(label)}${" ".repeat(width - label.length + gap)}${dim(description)}`,
    )
    .join("\n");
}
