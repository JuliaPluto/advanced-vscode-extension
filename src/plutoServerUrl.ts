/** Whether two URLs name the same server once normalized. */
export function sameUrl(a: string, b: string): boolean {
  return new URL(a).href === new URL(b).href;
}

/**
 * Why a tool server bound to one Pluto server cannot be pointed at
 * another, and how to get a tool server for the requested one.
 */
export function otherPlutoServerMessage(
  current: string,
  requested: string
): string {
  return (
    `This tool server works with the Pluto server at ${current}, not ${requested}. ` +
    `To use the Pluto server at ${requested}, run a separate command-line tool server: ` +
    `npx @plutojl/cli run --pluto-url ${requested} --mcp-port <another port>`
  );
}
