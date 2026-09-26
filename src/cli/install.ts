import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { InstallArgs } from "./config.ts";
import {
  MCP_SERVER_NAME,
  hasMcpServerEntry,
  mcpEndpointUrl,
  parseMcpClientConfig,
  upsertMcpServer,
  type McpClientFormat,
} from "../mcpClientConfig.ts";
import { bold, cyan, dim, green, yellow } from "./ui.ts";

/** A missing file reads as `undefined`; any other read failure aborts. */
function readConfigText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      `cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

function upsertServerEntry(
  filePath: string,
  format: McpClientFormat,
  mcpPort: number,
  opts: Pick<InstallArgs, "dryRun" | "force">
): void {
  const result = upsertMcpServer(readConfigText(filePath), {
    format,
    url: mcpEndpointUrl(mcpPort),
    force: opts.force || opts.dryRun,
  });

  if (result.kind === "invalid") {
    throw new Error(`${filePath} ${result.reason}; fix or remove it first`);
  }
  if (result.kind === "exists") {
    console.log(
      `  ${yellow("kept")} ${filePath} ${dim(`(${MCP_SERVER_NAME} already configured; --force replaces it)`)}`
    );
    return;
  }
  if (opts.dryRun) {
    console.log(`  ${dim("would write")} ${filePath}:`);
    console.log(result.text);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, result.text, "utf-8");
  console.log(`  ${green("written")} ${filePath}`);
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
        "claude-code",
        args.mcpPort,
        args
      );
    } else if (target === "copilot") {
      if (args.global) {
        console.log(
          `  ${yellow("skipped")} ${dim("--global is not supported for copilot; add the server through VS Code's 'MCP: Add Server' instead")}`
        );
        continue;
      }
      upsertServerEntry(copilotConfigPath(cwd), "vscode", args.mcpPort, args);
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
  const configured = (filePath: string, format: McpClientFormat): boolean => {
    let raw: string | undefined;
    try {
      raw = readConfigText(filePath);
    } catch {
      return false;
    }
    const parsed = parseMcpClientConfig(raw);
    return parsed.ok && hasMcpServerEntry(parsed.config, format);
  };
  return (
    configured(claudeCodeConfigPath(false, cwd, home), "claude-code") ||
    configured(claudeCodeConfigPath(true, cwd, home), "claude-code") ||
    configured(copilotConfigPath(cwd), "vscode")
  );
}
