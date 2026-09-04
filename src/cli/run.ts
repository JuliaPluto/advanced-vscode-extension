import "@plutojl/rainbow/node-polyfill";
import { PlutoManager } from "../plutoManager.ts";
import { PlutoMCPHttpServer } from "../mcp-server-http.ts";
import { NodeServerManager } from "./nodeServerManager.ts";
import { NodeFileReader } from "./nodeFileReader.ts";
import { consoleLogger } from "./logger.ts";
import { type CliConfig, VERSION } from "./config.ts";
import { type McpProbe, describeHost, probeMcp } from "./discover.ts";
import { hasMcpConfig } from "./install.ts";
import { mcpRequest } from "./call.ts";
import { bold, dim, err, green, yellow } from "./ui.ts";

const CMD = "npx @plutojl/cli";

/**
 * Bring Pluto up through a tool server that VS Code already runs on the
 * configured port. Options that shape a CLI-owned server cannot apply to
 * it and are reported as ignored.
 */
async function runThroughVSCode(
  existing: McpProbe,
  config: CliConfig
): Promise<void> {
  console.log(
    `${green("✓")} The VS Code extension runs a tool server at ${existing.url}`
  );
  console.log(dim(`  '${CMD} call' and '${CMD} tools' use it.`));

  const ignored: string[] = [];
  if (config.update) ignored.push("--update");
  if (config.juliaVersionExplicit) ignored.push("--julia-version");
  if (ignored.length) {
    console.log(
      yellow(
        `  ${ignored.join(" and ")} only apply to a server started by this CLI; pass --mcp-port <other port> for that.`
      )
    );
  }

  if (config.noPluto) {
    return;
  }
  if (existing.plutoRunning) {
    console.log(
      `${green("✓")} Pluto is connected${existing.plutoUrl ? ` at ${existing.plutoUrl}` : ""}; nothing to start.`
    );
    return;
  }

  const [tool, args, verb] = config.plutoUrl
    ? ["connect_to_pluto_server", { url: config.plutoUrl }, "Connecting to"]
    : ["start_pluto_server", {}, "Starting"];
  console.log(
    `[cli] ${verb} Pluto through the VS Code extension${config.plutoUrl ? ` (${config.plutoUrl})` : ""}...`
  );
  const result = await mcpRequest(
    existing.port,
    "tools/call",
    { name: tool, arguments: args },
    10 * 60 * 1000
  );
  const text = (result?.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  if (result?.isError) {
    console.error(`${err.red("✗")} ${text || "Pluto did not start."}`);
    process.exit(1);
  }
  console.log(`${green("✓")} ${text || "Pluto is ready."}`);
}

export async function run(config: CliConfig): Promise<void> {
  console.log(`${bold("@plutojl/cli")} ${dim(`v${VERSION}`)}\n`);

  // Whoever already listens on the port decides what `run` means: VS Code's
  // server is used as-is, another CLI server is a conflict.
  const existing = await probeMcp(config.mcpPort);
  if (existing?.host === "vscode") {
    await runThroughVSCode(existing, config);
    return;
  }
  if (existing) {
    const owner =
      existing.host === "unknown" ? "" : ` (${describeHost(existing.host)})`;
    console.error(
      `${err.yellow("!")} A tool server${owner} is already listening at ${existing.url}.`
    );
    console.error(
      err.dim(
        `  Stop it first, or pass --mcp-port <other port> to run a second one.`
      )
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
  } catch (e) {
    console.error(
      `[cli] Could not start the tool server on port ${config.mcpPort}: ${
        e instanceof Error ? e.message : String(e)
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
    } catch (e) {
      console.error(
        `[cli] ${err.yellow("Failed to start Pluto:")} ${e instanceof Error ? e.message : String(e)}`
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
      dim(
        `Tip: '${CMD} install' lets Claude Code or Copilot use this server.\n`
      )
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
    setTimeout(() => {
      console.error("[cli] Shutdown is taking too long; exiting.");
      process.exit(1);
    }, 15_000).unref();
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
