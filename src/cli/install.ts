import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { InstallArgs } from "./config.ts";
import { bold, cyan, dim, green, yellow } from "./ui.ts";

interface JsonObject {
  [key: string]: unknown;
}

const SERVER_NAME = "pluto-notebook";

/**
 * Read a JSON config file. A missing file is an empty config; any other
 * failure aborts, since merging into a file that could not be read would
 * overwrite it.
 */
function readJsonFile(filePath: string): JsonObject {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(
      `${filePath} is not valid JSON (${e instanceof Error ? e.message : String(e)}); fix or remove it first`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${filePath} must contain a JSON object; fix or remove it first`
    );
  }
  return parsed as JsonObject;
}

function readJsonFileIfPresent(filePath: string): JsonObject {
  try {
    return readJsonFile(filePath);
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
export function claudeCodeConfigPath(
  global: boolean,
  cwd: string,
  home: string = os.homedir()
): string {
  return global ? path.join(home, ".claude.json") : path.join(cwd, ".mcp.json");
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
  cwd: string = process.cwd(),
  home: string = os.homedir()
): void {
  console.log(bold("Installing MCP configuration"));

  const targets =
    args.target === "all" ? ["claude-code", "copilot"] : [args.target];

  for (const target of targets) {
    console.log(`${cyan(target)}`);
    if (target === "claude-code") {
      upsertServerEntry(
        claudeCodeConfigPath(args.global, cwd, home),
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

/** True when some MCP config in `cwd` or the home directory already points at the tool server. */
export function hasMcpConfig(
  cwd: string,
  home: string = os.homedir()
): boolean {
  const claudeConfigs = [
    readJsonFileIfPresent(claudeCodeConfigPath(false, cwd, home)),
    readJsonFileIfPresent(claudeCodeConfigPath(true, cwd, home)),
  ];
  const copilot = readJsonFileIfPresent(copilotConfigPath(cwd));
  return (
    claudeConfigs.some(
      (c) => !!((c.mcpServers as JsonObject | undefined) ?? {})[SERVER_NAME]
    ) || !!((copilot.servers as JsonObject | undefined) ?? {})[SERVER_NAME]
  );
}
