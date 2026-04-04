import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { InstallArgs } from "./config.ts";

interface JsonObject {
  [key: string]: unknown;
}

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
    console.log(`[dry-run] Would write to ${filePath}:`);
    console.log(content);
    return;
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  Written: ${filePath}`);
}

function installClaudeCode(
  mcpPort: number,
  global: boolean,
  dryRun: boolean,
  force: boolean
): void {
  // Claude Code reads MCP configs from:
  //   Project-level: .mcp.json at project root
  //   Global: ~/.claude.json (user-level)
  const filePath = global
    ? path.join(os.homedir(), ".claude.json")
    : path.join(process.cwd(), ".mcp.json");

  const existing = readJsonFile(filePath);
  const mcpServers = (existing.mcpServers ?? {}) as JsonObject;

  if (mcpServers["pluto-notebook"] && !force && !dryRun) {
    console.log(
      `  Skipping ${filePath} — pluto-notebook already configured (use --force to overwrite)`
    );
    return;
  }

  mcpServers["pluto-notebook"] = {
    type: "http",
    url: `http://localhost:${mcpPort}/mcp`,
  };

  existing.mcpServers = mcpServers;
  writeJsonFile(filePath, existing, dryRun);
}

function installCopilot(
  mcpPort: number,
  dryRun: boolean,
  force: boolean
): void {
  const filePath = path.join(process.cwd(), "mcp.json");
  const existing = readJsonFile(filePath);
  const servers = (existing.servers ?? {}) as JsonObject;

  if (servers["pluto-notebook"] && !force && !dryRun) {
    console.log(
      `  Skipping ${filePath} — pluto-notebook already configured (use --force to overwrite)`
    );
    return;
  }

  servers["pluto-notebook"] = {
    url: `http://localhost:${mcpPort}/mcp`,
    type: "http",
  };

  existing.servers = servers;
  if (!existing.inputs) {
    existing.inputs = [];
  }
  writeJsonFile(filePath, existing, dryRun);
}

export async function installMcpConfig(args: InstallArgs): Promise<void> {
  console.log("advanced-pluto-mcp — Installing MCP configuration\n");

  const targets =
    args.target === "all" ? ["claude-code", "copilot"] : [args.target];

  for (const target of targets) {
    console.log(`Target: ${target}`);
    if (target === "claude-code") {
      installClaudeCode(args.mcpPort, args.global, args.dryRun, args.force);
    } else if (target === "copilot") {
      installCopilot(args.mcpPort, args.dryRun, args.force);
    }
    console.log();
  }

  if (!args.dryRun) {
    console.log("Done! Start the MCP server with: npx advanced-pluto-mcp run");
  }
}
