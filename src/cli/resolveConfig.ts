import * as fs from "fs";
import * as path from "path";
import type { CliConfig, InstallArgs } from "./config.ts";
import { DEFAULTS } from "./config.ts";
import type { RawArgs } from "./parseArgs.ts";

interface ConfigFile {
  plutoPort?: number;
  mcpPort?: number;
  juliaVersion?: string;
  serverUrl?: string;
}

function loadConfigFile(dir: string): ConfigFile {
  const filePath = path.join(dir, ".plutomcp.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return {};
  }
}

function envInt(name: string): number | undefined {
  const val = process.env[name];
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

export function resolveRunConfig(args: RawArgs): CliConfig {
  const workDir = process.cwd();
  const file = loadConfigFile(workDir);

  return {
    mcpPort:
      args.mcpPort ??
      envInt("PLUTO_MCP_PORT") ??
      file.mcpPort ??
      DEFAULTS.mcpPort,
    plutoPort:
      args.plutoPort ??
      envInt("PLUTO_PORT") ??
      file.plutoPort ??
      DEFAULTS.plutoPort,
    plutoUrl:
      args.plutoUrl ??
      process.env.PLUTO_SERVER_URL ??
      file.serverUrl ??
      undefined,
    juliaVersion:
      args.juliaVersion ??
      process.env.JULIA_VERSION ??
      file.juliaVersion ??
      DEFAULTS.juliaVersion,
    workDir,
    noPluto: args.noPluto ?? false,
  };
}

/** MCP port resolution shared by run/install/tools/call: CLI arg > env > .plutomcp.json > default */
export function resolveMcpPort(args: RawArgs): number {
  const file = loadConfigFile(process.cwd());
  return (
    args.mcpPort ?? envInt("PLUTO_MCP_PORT") ?? file.mcpPort ?? DEFAULTS.mcpPort
  );
}

export function resolveInstallArgs(args: RawArgs): InstallArgs {
  return {
    target: args.target ?? "claude-code",
    mcpPort: args.mcpPort ?? envInt("PLUTO_MCP_PORT") ?? DEFAULTS.mcpPort,
    global: args.global ?? false,
    dryRun: args.dryRun ?? false,
    force: args.force ?? false,
  };
}
