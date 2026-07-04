import "@plutojl/rainbow/node-polyfill";
import { PlutoManager } from "../plutoManager.ts";
import { PlutoMCPHttpServer } from "../mcp-server-http.ts";
import { NodeServerManager } from "./nodeServerManager.ts";
import { NodeFileReader } from "./nodeFileReader.ts";
import { consoleLogger } from "./logger.ts";
import { type CliConfig, VERSION } from "./config.ts";

export async function run(config: CliConfig): Promise<void> {
  console.log(`@plutojl/cli v${VERSION} — command-line tool for Pluto.jl\n`);

  const serverManager = new NodeServerManager(
    config.plutoPort,
    config.juliaVersion,
    config.workDir
  );

  const plutoManager = new PlutoManager(
    config.plutoPort,
    consoleLogger,
    serverManager,
    new NodeFileReader(),
    config.plutoUrl
  );

  // Start the MCP HTTP server first (so health endpoint is available during Pluto startup)
  const mcpServer = new PlutoMCPHttpServer(plutoManager, config.mcpPort);
  try {
    await mcpServer.start();
  } catch (err) {
    console.error(
      `[cli] Could not start the tool server on port ${config.mcpPort}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    console.error(
      `[cli] Is another 'run' already active? Pass --mcp-port <port> to use a different port.`
    );
    process.exit(1);
  }

  console.log(
    `[cli] MCP server listening at http://localhost:${config.mcpPort}/mcp`
  );
  console.log(`[cli] Health check: http://localhost:${config.mcpPort}/health`);

  // Auto-start Pluto unless --no-pluto was passed
  if (!config.noPluto) {
    if (config.plutoUrl) {
      console.log(
        `[cli] Connecting to existing Pluto server at ${config.plutoUrl}...`
      );
    } else {
      console.log(`[cli] Starting Pluto server on port ${config.plutoPort}...`);
    }
    try {
      await plutoManager.start();
      console.log(`[cli] Pluto server is ready.`);
    } catch (err) {
      console.error(
        `[cli] Failed to start Pluto: ${err instanceof Error ? err.message : String(err)}`
      );
      console.error(
        `[cli] MCP server is still running — you can start Pluto later via:`
      );
      console.error(`[cli]   npx @plutojl/cli call start_pluto_server`);
    }
  } else {
    console.log(`[cli] Pluto auto-start skipped (--no-pluto).`);
    console.log(
      `[cli] Start it later: npx @plutojl/cli call start_pluto_server`
    );
  }

  console.log(`\n[cli] Press Ctrl+C to stop\n`);
  console.log(`Tip: Run 'npx @plutojl/cli install' to configure Claude Code\n`);

  // Graceful shutdown — owns both signals; guard against a second signal
  // arriving while shutdown is already in progress
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log("\n[cli] Shutting down...");
    try {
      await mcpServer.stop();
    } catch {
      // ignore
    }
    try {
      await plutoManager.stop();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
