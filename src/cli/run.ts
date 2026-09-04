import "@plutojl/rainbow/node-polyfill";
import { PlutoManager } from "../plutoManager.ts";
import { PlutoMCPHttpServer } from "../mcp-server-http.ts";
import { NodeServerManager } from "./nodeServerManager.ts";
import { NodeFileReader } from "./nodeFileReader.ts";
import { consoleLogger } from "./logger.ts";
import { type CliConfig, VERSION } from "./config.ts";
import { describeHost, probeMcp } from "./discover.ts";
import { hasMcpConfig } from "./install.ts";
import { bold, dim, green, yellow } from "./ui.ts";

const CMD = "npx @plutojl/cli";

export async function run(config: CliConfig): Promise<void> {
  console.log(`${bold("@plutojl/cli")} ${dim(`v${VERSION}`)}\n`);

  // A tool server already on this port is either VS Code's (fine: use it)
  // or another `run` (a mistake) — say which instead of failing on EADDRINUSE
  const existing = await probeMcp(config.mcpPort);
  if (existing) {
    if (existing.host === "vscode") {
      console.log(
        `${green("✓")} The VS Code extension already runs a tool server at ${existing.url}`
      );
      console.log(
        dim(`  '${CMD} call' and '${CMD} tools' use it; nothing to start.`)
      );
      console.log(
        dim(`  To run a separate server anyway, pass --mcp-port <other port>.`)
      );
      return;
    }
    const owner =
      existing.host === "unknown" ? "" : ` (${describeHost(existing.host)})`;
    console.error(
      `${yellow("!")} A tool server${owner} is already listening at ${existing.url}.`
    );
    console.error(
      dim(`  Stop it first, or pass --mcp-port <other port> to run a second one.`)
    );
    process.exit(1);
  }

  const serverManager = new NodeServerManager(
    config.plutoPort,
    config.juliaVersion,
    config.workDir,
    { update: config.update }
  );

  const plutoManager = new PlutoManager(
    config.plutoPort,
    consoleLogger,
    serverManager,
    new NodeFileReader(),
    config.plutoUrl
  );

  // Start the MCP HTTP server first (so health endpoint is available during Pluto startup)
  const mcpServer = new PlutoMCPHttpServer(plutoManager, config.mcpPort, {
    host: "cli",
    version: VERSION,
  });
  try {
    await mcpServer.start();
  } catch (err) {
    console.error(
      `[cli] Could not start the tool server on port ${config.mcpPort}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    console.error(
      `[cli] Something else owns that port. Pass --mcp-port <port> to use a different one.`
    );
    process.exit(1);
  }

  console.log(
    `[cli] Tool server listening at http://localhost:${config.mcpPort}/mcp`
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
      console.log(`[cli] ${green("Pluto server is ready.")}`);
    } catch (err) {
      console.error(
        `[cli] ${yellow("Failed to start Pluto:")} ${err instanceof Error ? err.message : String(err)}`
      );
      console.error(
        `[cli] The tool server is still running — start Pluto later with:`
      );
      console.error(`[cli]   ${CMD} call start_pluto_server`);
      console.error(
        `[cli] If the Julia environment looks broken, rerun with --update.`
      );
    }
  } else {
    console.log(`[cli] Pluto auto-start skipped (--no-pluto).`);
    console.log(`[cli] Start it later: ${CMD} call start_pluto_server`);
  }

  console.log(`\n[cli] Press Ctrl+C to stop\n`);
  if (!hasMcpConfig(config.workDir)) {
    console.log(
      dim(`Tip: '${CMD} install' lets Claude Code or Copilot use this server.\n`)
    );
  }

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
