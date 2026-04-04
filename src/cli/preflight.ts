/**
 * Preflight checks for CLI commands that need a running MCP (and optionally Pluto) server.
 * Prints clear diagnostics and exits if something is missing.
 */

interface HealthResponse {
  status: string;
  plutoServerRunning: boolean;
  activeSessions: number;
}

interface PreflightResult {
  mcpRunning: true;
  plutoRunning: boolean;
}

export async function preflight(
  port: number,
  opts: { requirePluto?: boolean } = {}
): Promise<PreflightResult> {
  const mcpUrl = `http://localhost:${port}`;

  // 1. Check MCP server
  let health: HealthResponse;
  try {
    const res = await fetch(`${mcpUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    health = (await res.json()) as HealthResponse;
  } catch {
    console.error(`Error: Cannot reach MCP server at ${mcpUrl}`);
    console.error(``);
    console.error(`The MCP server is not running. Start it first:`);
    console.error(``);
    console.error(`  npx @plutojl/mcp run`);
    console.error(``);
    console.error(
      `Or, if you are using a different port, pass --mcp-port <port>.`
    );
    process.exit(1);
  }

  // 2. Check Pluto server (if required)
  if (opts.requirePluto && !health.plutoServerRunning) {
    console.error(`Error: MCP server is running but Pluto is not connected.`);
    console.error(``);
    console.error(`Start Pluto via the MCP server:`);
    console.error(``);
    console.error(`  npx @plutojl/mcp call start_pluto_server`);
    console.error(``);
    console.error(`Or connect to an existing Pluto server:`);
    console.error(``);
    console.error(
      `  npx @plutojl/mcp call connect_to_pluto_server '{"port": 1234}'`
    );
    process.exit(1);
  }

  return { mcpRunning: true, plutoRunning: health.plutoServerRunning };
}
