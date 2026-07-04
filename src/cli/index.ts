import { parseArgs } from "./parseArgs.ts";
import {
  resolveRunConfig,
  resolveInstallArgs,
  resolveMcpPort,
} from "./resolveConfig.ts";
import { run } from "./run.ts";
import { installMcpConfig } from "./install.ts";
import { callTool, listTools } from "./call.ts";
import { preflight } from "./preflight.ts";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mcpPort = resolveMcpPort(args);

  switch (args.command) {
    case "run": {
      const config = resolveRunConfig(args);
      await run(config);
      break;
    }
    case "install": {
      const installArgs = resolveInstallArgs(args);
      await installMcpConfig(installArgs);
      break;
    }
    case "tools": {
      await preflight(mcpPort);
      await listTools(mcpPort);
      break;
    }
    case "call": {
      if (!args.toolName) {
        console.error("Usage: npx @plutojl/cli call <tool_name> [json_args]");
        process.exit(1);
      }
      await preflight(mcpPort);
      await callTool(
        mcpPort,
        args.toolName,
        args.toolArgs ?? "{}",
        args.raw ?? false,
        (args.timeoutSeconds ?? 120) * 1000
      );
      break;
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
