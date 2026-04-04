import { DEFAULTS } from "./config.ts";

export interface RawArgs {
  command: "run" | "install" | "help";
  mcpPort?: number;
  plutoPort?: number;
  plutoUrl?: string;
  juliaVersion?: string;
  // install-specific
  target?: "claude-code" | "copilot" | "all";
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

function printHelp(): void {
  console.log(`
@plutojl/mcp — Standalone MCP server for Pluto.jl notebooks

Usage:
  npx @plutojl/mcp <command> [options]

Commands:
  run       Start the MCP server (and Pluto server if needed)
  install   Add MCP config to .claude/ or .vscode/ directory

Run options:
  --mcp-port <port>        MCP server port (default: ${DEFAULTS.mcpPort})
  --pluto-port <port>      Pluto server port (default: ${DEFAULTS.plutoPort})
  --pluto-url <url>        Connect to existing Pluto server (skip starting one)
  --julia-version <ver>    Julia version via juliaup (default: ${DEFAULTS.juliaVersion})

Install options:
  --target <target>        Config target: claude-code, copilot, all (default: claude-code)
  --mcp-port <port>        MCP server port to configure (default: ${DEFAULTS.mcpPort})
  --global                 Write to ~/.claude.json instead of ./.mcp.json
  --dry-run                Print config without writing
  --force                  Overwrite existing config without prompting

Examples:
  npx @plutojl/mcp run
  npx @plutojl/mcp run --pluto-url http://localhost:1234
  npx @plutojl/mcp install
  npx @plutojl/mcp install --target all --global
`);
}

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
    if (cmd === "run" || cmd === "install" || cmd === "help") {
      args.command = cmd;
    } else {
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
    }
    i++;
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
