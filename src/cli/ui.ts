/**
 * Minimal ANSI styling. Colors are enabled per stream: only for a TTY that
 * has not opted out via NO_COLOR / TERM=dumb, or always when FORCE_COLOR is set.
 */

export interface Styles {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
}

function colorEnabled(stream: NodeJS.WriteStream): boolean {
  const env = process.env;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  return !!stream.isTTY;
}

export function stylesFor(stream: NodeJS.WriteStream): Styles {
  const enabled = colorEnabled(stream);
  const style =
    (open: number, close: number) =>
    (s: string): string =>
      enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;
  return {
    bold: style(1, 22),
    dim: style(2, 22),
    red: style(31, 39),
    green: style(32, 39),
    yellow: style(33, 39),
    cyan: style(36, 39),
  };
}

const out = stylesFor(process.stdout);

/** Styles for text written to stdout. */
export const { bold, dim, red, green, yellow, cyan } = out;

/** Styles for text written to stderr. */
export const err = stylesFor(process.stderr);

/** Left-align `label` in a fixed column so rows line up. */
export function row(label: string, text: string, width = 13): string {
  return `  ${label.padEnd(width)}${text}`;
}
