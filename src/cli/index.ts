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
import { VERSION } from "./config.ts";
import { err } from "./ui.ts";
import type { RawArgs } from "./parseArgs.ts";

async function printHelp(args: RawArgs): Promise<void> {
  console.log(helpText());
  const status = await collectStatus(resolveRunConfig(args));
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
    if (found.port !== explicit.port) {
      console.error(
        err.dim(`using the VS Code extension's tool server at ${found.url}`)
      );
    }
    return found.port;
  }
  console.error(
    usageErrorText(
      `no tool server is running on port ${explicit.port}. Start one with 'npx @plutojl/cli run'` +
        (explicit.explicit
          ? ""
          : ", or pass --mcp-port if it uses another port")
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
      await printHelp(args);
      break;
    case "version":
      console.log(VERSION);
      break;
    case "status": {
      const config = resolveRunConfig(args);
      const deadline = Date.now() + (args.timeoutSeconds ?? 600) * 1000;
      let status = await collectStatus(config);
      const ready = () => !!status.mcp && status.mcp.plutoRunning;
      while (args.wait && !ready() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        status = await collectStatus(config);
      }
      if (args.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(statusText(status));
        if (args.wait && !ready()) {
          console.error(
            err.yellow(
              `Gave up waiting after ${args.timeoutSeconds ?? 600}s; pass --timeout <seconds> to wait longer.`
            )
          );
        }
      }
      process.exit(args.wait ? (ready() ? 0 : 1) : status.mcp ? 0 : 1);
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
      await callTool(port, args.toolName!, args.toolArgs ?? "{}", {
        raw: args.raw ?? false,
        timeoutMs: (args.timeoutSeconds ?? 120) * 1000,
        out: args.out,
      });
      break;
    }
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`${err.red("error:")} ${message}`);
  if (process.env.PLUTO_CLI_DEBUG && e instanceof Error && e.stack) {
    console.error(err.dim(e.stack));
  }
  process.exit(1);
});
