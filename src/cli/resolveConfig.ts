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

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function loadConfigFile(dir: string): ConfigFile {
  return readJsonObject(path.join(dir, CONFIG_FILE)) as ConfigFile;
}

/**
 * The port the VS Code extension's tool server starts on in this workspace
 * (`pluto-notebook.mcpPort` in .vscode/settings.json), when set.
 */
export function loadVSCodeMcpPort(dir: string): number | undefined {
  const settings = readJsonObject(path.join(dir, ".vscode", "settings.json"));
  const value = settings["pluto-notebook.mcpPort"];
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
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
  /**
   * True when the port was named on the command line or in the environment.
   * Ports from config files are a starting point that discovery may look past.
   */
  explicit: boolean;
}

/**
 * Tool-server port shared by every command:
 * flag > env > .plutomcp.json > pluto-notebook.mcpPort in .vscode/settings.json > default.
 */
export function resolveMcpPort(
  args: RawArgs,
  ctx: ResolveContext = {}
): McpPortResolution {
  const env = ctx.env ?? process.env;
  const cwd = ctx.cwd ?? process.cwd();
  const explicit = args.mcpPort ?? envInt("PLUTO_MCP_PORT", env);
  if (explicit !== undefined) {
    return { port: explicit, explicit: true };
  }
  const port =
    loadConfigFile(cwd).mcpPort ?? loadVSCodeMcpPort(cwd) ?? DEFAULTS.mcpPort;
  return { port, explicit: false };
}

/** The Pluto server URL, which must be an absolute http(s) URL. */
function checkPlutoUrl(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  const source =
    "--pluto-url (or PLUTO_SERVER_URL, or serverUrl in .plutomcp.json)";
  if (!/^https?:\/\//i.test(url)) {
    const hint = url.includes("://") ? "" : ` — did you mean 'http://${url}'?`;
    throw new Error(
      `${source} must start with http:// or https://, got '${url}'${hint}`
    );
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`${source} is not a valid URL: '${url}'`);
  }
  return url;
}

export function resolveRunConfig(
  args: RawArgs,
  ctx: ResolveContext = {}
): CliConfig {
  const env = ctx.env ?? process.env;
  const workDir = ctx.cwd ?? process.cwd();
  const file = loadConfigFile(workDir);
  const mcp = resolveMcpPort(args, ctx);
  const juliaVersion =
    args.juliaVersion ?? env.JULIA_VERSION ?? file.juliaVersion;

  return {
    mcpPort: mcp.port,
    mcpPortExplicit: mcp.explicit,
    plutoPort:
      args.plutoPort ??
      envInt("PLUTO_PORT", env) ??
      file.plutoPort ??
      DEFAULTS.plutoPort,
    plutoUrl: checkPlutoUrl(
      args.plutoUrl ?? env.PLUTO_SERVER_URL ?? file.serverUrl ?? undefined
    ),
    plutoExplicit:
      args.plutoPort !== undefined ||
      args.plutoUrl !== undefined ||
      envInt("PLUTO_PORT", env) !== undefined ||
      env.PLUTO_SERVER_URL !== undefined,
    juliaVersion: juliaVersion ?? DEFAULTS.juliaVersion,
    juliaVersionExplicit: juliaVersion !== undefined,
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
