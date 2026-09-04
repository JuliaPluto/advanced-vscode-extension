import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { InstallArgs } from "./config.ts";
import { bold, cyan, dim, green, yellow } from "./ui.ts";

interface JsonObject {
  [key: string]: unknown;
}

const SERVER_NAME = "pluto-notebook";

function readJsonFile(filePath: string): JsonObject {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as JsonObject;
  } catch {
    return {};
  }
}

function writeJsonFile(
  filePath: string,
  data: JsonObject,
  dryRun: boolean
): void {
  const content = JSON.stringify(data, null, 2) + "\n";
  if (dryRun) {
    console.log(`  ${dim("would write")} ${filePath}:`);
    console.log(content);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  ${green("written")} ${filePath}`);
}

/**
 * Merge a `pluto-notebook` entry into the server map at `key` of the JSON
 * file at `filePath`, leaving other entries untouched.
 */
function upsertServerEntry(
  filePath: string,
  key: "mcpServers" | "servers",
  entry: JsonObject,
  opts: Pick<InstallArgs, "dryRun" | "force">,
  extra?: (config: JsonObject) => void
): void {
  const existing = readJsonFile(filePath);
  const servers = (existing[key] ?? {}) as JsonObject;

  if (servers[SERVER_NAME] && !opts.force && !opts.dryRun) {
    console.log(
      `  ${yellow("kept")} ${filePath} ${dim(`(${SERVER_NAME} already configured; --force replaces it)`)}`
    );
    return;
  }

  servers[SERVER_NAME] = entry;
  existing[key] = servers;
  extra?.(existing);
  writeJsonFile(filePath, existing, opts.dryRun);
}

/** Claude Code reads `.mcp.json` at the project root, or `~/.claude.json` user-wide. */
export function claudeCodeConfigPath(global: boolean, cwd: string): string {
  return global
    ? path.join(os.homedir(), ".claude.json")
    : path.join(cwd, ".mcp.json");
}

/** VS Code (GitHub Copilot) reads workspace MCP servers from `.vscode/mcp.json`. */
export function copilotConfigPath(cwd: string): string {
  return path.join(cwd, ".vscode", "mcp.json");
}

function serverEntry(mcpPort: number): JsonObject {
  // The tool server speaks streamable HTTP (with a legacy SSE fallback
  // on the same endpoint for older clients)
  return { type: "http", url: `http://localhost:${mcpPort}/mcp` };
}

export function installMcpConfig(
  args: InstallArgs,
  cwd: string = process.cwd()
): void {
  console.log(bold("Installing MCP configuration"));

  const targets =
    args.target === "all" ? ["claude-code", "copilot"] : [args.target];

  for (const target of targets) {
    console.log(`${cyan(target)}`);
    if (target === "claude-code") {
      upsertServerEntry(
        claudeCodeConfigPath(args.global, cwd),
        "mcpServers",
        serverEntry(args.mcpPort),
        args
      );
    } else if (target === "copilot") {
      if (args.global) {
        console.log(
          `  ${yellow("skipped")} ${dim("--global is not supported for copilot; add the server through VS Code's 'MCP: Add Server' instead")}`
        );
        continue;
      }
      upsertServerEntry(
        copilotConfigPath(cwd),
        "servers",
        serverEntry(args.mcpPort),
        args,
        (config) => {
          config.inputs ??= [];
        }
      );
    }
  }

  if (!args.dryRun) {
    console.log(`\nStart the tool server with: npx @plutojl/cli run`);
  }
}

/** True when some MCP config in `cwd` already points at the tool server. */
export function hasMcpConfig(cwd: string): boolean {
  const claude = readJsonFile(claudeCodeConfigPath(false, cwd));
  const copilot = readJsonFile(copilotConfigPath(cwd));
  const globalClaude = readJsonFile(claudeCodeConfigPath(true, cwd));
  return [claude, globalClaude].some(
    (c) => !!((c.mcpServers as JsonObject | undefined) ?? {})[SERVER_NAME]
  ) || !!((copilot.servers as JsonObject | undefined) ?? {})[SERVER_NAME];
}
