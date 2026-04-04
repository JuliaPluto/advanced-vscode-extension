import "@plutojl/rainbow/node-polyfill";
import { PlutoManager } from "../plutoManager.ts";
import { PlutoMCPHttpServer } from "../mcp-server-http.ts";
import { NodeServerManager } from "./nodeServerManager.ts";
import { NodeFileReader } from "./nodeFileReader.ts";
import { consoleLogger } from "./logger.ts";
import type { CliConfig } from "./config.ts";

export async function run(config: CliConfig): Promise<void> {
  console.log("@plutojl/mcp — Standalone MCP server for Pluto.jl\n");

  let serverManager: NodeServerManager | undefined;
  let plutoManager: PlutoManager;

  if (config.plutoUrl) {
    // Connect to existing Pluto server
    console.log(
      `[cli] Connecting to existing Pluto server at ${config.plutoUrl}`
    );
    // Create a dummy server manager that does nothing (Pluto is externally managed)
    serverManager = new NodeServerManager(
      config.plutoPort,
      config.juliaVersion,
      config.workDir
    );
    plutoManager = new PlutoManager(
      config.plutoPort,
      consoleLogger,
      serverManager,
      new NodeFileReader(),
      config.plutoUrl
    );
  } else {
    // Start our own Pluto server
    serverManager = new NodeServerManager(
      config.plutoPort,
      config.juliaVersion,
      config.workDir
    );
    plutoManager = new PlutoManager(
      config.plutoPort,
      consoleLogger,
      serverManager,
      new NodeFileReader()
    );
  }

  // Start the MCP HTTP server (handleSignals = true for CLI)
  const mcpServer = new PlutoMCPHttpServer(plutoManager, config.mcpPort, true);
  await mcpServer.start();

  console.log(
    `\n[cli] MCP server listening at http://localhost:${config.mcpPort}/mcp`
  );
  console.log(`[cli] Health check: http://localhost:${config.mcpPort}/health`);
  console.log(`[cli] Press Ctrl+C to stop\n`);
  console.log(`Tip: Run 'npx @plutojl/mcp install' to configure Claude Code\n`);

  // Graceful shutdown
  const shutdown = async () => {
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

  process.on("SIGTERM", () => void shutdown());
}
