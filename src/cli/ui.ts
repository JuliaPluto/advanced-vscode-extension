/**
 * Minimal ANSI styling. Colors are enabled only for a TTY that has not
 * opted out via NO_COLOR / TERM=dumb, or when FORCE_COLOR is set.
 */

function colorEnabled(): boolean {
  const env = process.env;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  return !!process.stdout.isTTY;
}

const enabled = colorEnabled();

function style(open: number, close: number): (s: string) => string {
  return (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const bold = style(1, 22);
export const dim = style(2, 22);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const cyan = style(36, 39);

/** Left-align `label` in a fixed column so rows line up. */
export function row(label: string, text: string, width = 13): string {
  return `  ${label.padEnd(width)}${text}`;
}
