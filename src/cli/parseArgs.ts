import { DEFAULTS } from "./config.ts";

export interface RawArgs {
  command: "run" | "install" | "call" | "tools" | "help";
  mcpPort?: number;
  plutoPort?: number;
  plutoUrl?: string;
  juliaVersion?: string;
  // install-specific
  target?: "claude-code" | "copilot" | "all";
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  // run-specific
  noPluto?: boolean;
  // call-specific
  toolName?: string;
  toolArgs?: string;
  raw?: boolean;
}

function printHelp(): void {
  console.log(`
@plutojl/mcp — Standalone MCP server for Pluto.jl notebooks

Usage:
  npx @plutojl/mcp <command> [options]

Commands:
  run       Start the MCP server (and Pluto server if needed)
  install   Add MCP config to .mcp.json or mcp.json
  tools     List available MCP tools on a running server
  call      Call an MCP tool on a running server

Run options:
  --mcp-port <port>        MCP server port (default: ${DEFAULTS.mcpPort})
  --pluto-port <port>      Pluto server port (default: ${DEFAULTS.plutoPort})
  --pluto-url <url>        Connect to existing Pluto server (skip starting one)
  --julia-version <ver>    Julia version via juliaup (default: ${DEFAULTS.juliaVersion})
  --no-pluto               Start MCP server only, without starting Pluto

Install options:
  --target <target>        Config target: claude-code, copilot, all (default: claude-code)
  --mcp-port <port>        MCP server port to configure (default: ${DEFAULTS.mcpPort})
  --global                 Write to ~/.claude.json instead of ./.mcp.json
  --dry-run                Print config without writing
  --force                  Overwrite existing config without prompting

Call options:
  npx @plutojl/mcp call <tool_name> [json_args]
  --mcp-port <port>        MCP server port (default: ${DEFAULTS.mcpPort})
  --raw                    Output raw JSON response

Tools options:
  --mcp-port <port>        MCP server port (default: ${DEFAULTS.mcpPort})

Examples:
  npx @plutojl/mcp run
  npx @plutojl/mcp run --pluto-url http://localhost:1234
  npx @plutojl/mcp install
  npx @plutojl/mcp install --target all --global
  npx @plutojl/mcp tools
  npx @plutojl/mcp call get_notebook_status
  npx @plutojl/mcp call start_pluto_server '{"port": 1234}'
  npx @plutojl/mcp call open_notebook '{"path": "/tmp/nb.pluto.jl"}'
`);
}

const COMMANDS = new Set(["run", "install", "call", "tools", "help"]);

export function parseArgs(argv: string[]): RawArgs {
  const args: RawArgs = { command: "help" };

  let i = 0;

  // First non-flag token is the command
  while (i < argv.length && argv[i].startsWith("-")) {
    if (argv[i] === "--help" || argv[i] === "-h") {
      printHelp();
      process.exit(0);
    }
    i++;
  }

  if (i < argv.length) {
    const cmd = argv[i];
    if (COMMANDS.has(cmd)) {
      args.command = cmd as RawArgs["command"];
    } else {
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
    }
    i++;
  }

  // For `call`, grab positional args: tool_name and optional json_args
  if (args.command === "call") {
    // Collect positional args (non-flag tokens) before any flags
    while (i < argv.length && !argv[i].startsWith("-")) {
      if (!args.toolName) {
        args.toolName = argv[i];
      } else if (!args.toolArgs) {
        args.toolArgs = argv[i];
      }
      i++;
    }
  }

  // Parse flags
  while (i < argv.length) {
    const flag = argv[i];

    if (flag === "--help" || flag === "-h") {
      printHelp();
      process.exit(0);
    }

    if (flag === "--mcp-port" && i + 1 < argv.length) {
      args.mcpPort = parseInt(argv[++i], 10);
    } else if (flag === "--pluto-port" && i + 1 < argv.length) {
      args.plutoPort = parseInt(argv[++i], 10);
    } else if (flag === "--pluto-url" && i + 1 < argv.length) {
      args.plutoUrl = argv[++i];
    } else if (flag === "--julia-version" && i + 1 < argv.length) {
      args.juliaVersion = argv[++i];
    } else if (flag === "--target" && i + 1 < argv.length) {
      const target = argv[++i];
      if (
        target === "claude-code" ||
        target === "copilot" ||
        target === "all"
      ) {
        args.target = target;
      } else {
        console.error(
          `Unknown target: ${target} (use claude-code, copilot, or all)`
        );
        process.exit(1);
      }
    } else if (flag === "--global") {
      args.global = true;
    } else if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--force") {
      args.force = true;
    } else if (flag === "--raw") {
      args.raw = true;
    } else if (flag === "--no-pluto") {
      args.noPluto = true;
    } else {
      console.warn(`Unknown flag: ${flag}`);
    }

    i++;
  }

  if (args.command === "help") {
    printHelp();
    process.exit(0);
  }

  return args;
}
