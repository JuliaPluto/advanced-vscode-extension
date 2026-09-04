import { parseArgs, UsageError } from "./parseArgs.ts";
import {
  resolveRunConfig,
  resolveInstallArgs,
  resolveMcpPort,
} from "./resolveConfig.ts";
import { run } from "./run.ts";
import { installMcpConfig } from "./install.ts";
import { callTool, listTools } from "./call.ts";
import { collectStatus, discoverMcp } from "./discover.ts";
import { helpText, statusText, usageErrorText } from "./help.ts";
import { DEFAULTS, VERSION } from "./config.ts";
import { dim } from "./ui.ts";

async function printHelp(): Promise<void> {
  console.log(helpText());
  const status = await collectStatus({
    mcpPort: DEFAULTS.mcpPort,
    mcpPortExplicit: false,
    plutoPort: DEFAULTS.plutoPort,
  });
  console.log();
  console.log(statusText(status));
}

/**
 * Port of the tool server that `tools` and `call` should talk to. A
 * configured port is used as-is; otherwise a running server is looked
 * for, preferring the VS Code extension's when inside VS Code.
 */
async function requireMcpPort(explicit: {
  port: number;
  explicit: boolean;
}): Promise<number> {
  const found = await discoverMcp(explicit);
  if (found) {
    return found.port;
  }
  console.error(
    usageErrorText(
      `no tool server is running on port ${explicit.port}. Start one with 'npx @plutojl/cli run'` +
        (explicit.explicit ? "" : ", or pass --mcp-port if it uses another port")
    )
  );
  process.exit(1);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(usageErrorText(err.message));
      process.exit(2);
    }
    throw err;
  }

  switch (args.command) {
    case "help":
      await printHelp();
      break;
    case "version":
      console.log(VERSION);
      break;
    case "status": {
      const config = resolveRunConfig(args);
      const status = await collectStatus(config);
      if (args.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(statusText(status));
      }
      process.exit(status.mcp ? 0 : 1);
      break;
    }
    case "run":
      await run(resolveRunConfig(args));
      break;
    case "install":
      installMcpConfig(resolveInstallArgs(args));
      break;
    case "tools": {
      const port = await requireMcpPort(resolveMcpPort(args));
      await listTools(port, args.toolFilter);
      break;
    }
    case "call": {
      const port = await requireMcpPort(resolveMcpPort(args));
      await callTool(
        port,
        args.toolName!,
        args.toolArgs ?? "{}",
        args.raw ?? false,
        (args.timeoutSeconds ?? 120) * 1000
      );
      break;
    }
  }
}

main().catch((err) => {
  console.error(
    `${usageErrorText(err instanceof Error ? err.message : String(err)).split("\n")[0]}`
  );
  if (process.env.PLUTO_CLI_DEBUG && err instanceof Error && err.stack) {
    console.error(dim(err.stack));
  }
  process.exit(1);
});
