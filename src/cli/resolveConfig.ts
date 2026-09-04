import * as fs from "fs";
import * as path from "path";
import type { CliConfig, InstallArgs } from "./config.ts";
import { CONFIG_FILE, DEFAULTS } from "./config.ts";
import type { RawArgs } from "./parseArgs.ts";

interface ConfigFile {
  plutoPort?: number;
  mcpPort?: number;
  juliaVersion?: string;
  serverUrl?: string;
}

export function loadConfigFile(dir: string): ConfigFile {
  const filePath = path.join(dir, CONFIG_FILE);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return {};
  }
}

function envInt(name: string, env: NodeJS.ProcessEnv): number | undefined {
  const val = env[name];
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

export interface ResolveContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface McpPortResolution {
  port: number;
  /** True when the port came from a flag, env var, or config file rather than the default. */
  explicit: boolean;
}

/** Tool-server port shared by every command: flag > env > .plutomcp.json > default. */
export function resolveMcpPort(
  args: RawArgs,
  ctx: ResolveContext = {}
): McpPortResolution {
  const env = ctx.env ?? process.env;
  const file = loadConfigFile(ctx.cwd ?? process.cwd());
  const configured =
    args.mcpPort ?? envInt("PLUTO_MCP_PORT", env) ?? file.mcpPort;
  return configured === undefined
    ? { port: DEFAULTS.mcpPort, explicit: false }
    : { port: configured, explicit: true };
}

export function resolveRunConfig(
  args: RawArgs,
  ctx: ResolveContext = {}
): CliConfig {
  const env = ctx.env ?? process.env;
  const workDir = ctx.cwd ?? process.cwd();
  const file = loadConfigFile(workDir);
  const mcp = resolveMcpPort(args, ctx);

  return {
    mcpPort: mcp.port,
    mcpPortExplicit: mcp.explicit,
    plutoPort:
      args.plutoPort ??
      envInt("PLUTO_PORT", env) ??
      file.plutoPort ??
      DEFAULTS.plutoPort,
    plutoUrl:
      args.plutoUrl ?? env.PLUTO_SERVER_URL ?? file.serverUrl ?? undefined,
    juliaVersion:
      args.juliaVersion ??
      env.JULIA_VERSION ??
      file.juliaVersion ??
      DEFAULTS.juliaVersion,
    workDir,
    noPluto: args.noPluto ?? false,
    update: args.update ?? false,
  };
}

export function resolveInstallArgs(
  args: RawArgs,
  ctx: ResolveContext = {}
): InstallArgs {
  return {
    target: args.target ?? "claude-code",
    mcpPort: resolveMcpPort(args, ctx).port,
    global: args.global ?? false,
    dryRun: args.dryRun ?? false,
    force: args.force ?? false,
  };
}
