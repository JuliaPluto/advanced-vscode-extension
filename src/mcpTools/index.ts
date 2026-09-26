import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { cellTools } from "./cellTools.ts";
import { notebookTools } from "./notebookTools.ts";
import { outputTools } from "./outputTools.ts";
import { serverTools } from "./serverTools.ts";
import type { PlutoTool, PlutoToolsManager } from "./tool.ts";

export type { PlutoTool, PlutoToolsManager } from "./tool.ts";

/** Every tool, built once per manager and shared by all sessions. */
export interface PlutoToolSet {
  readonly tools: readonly PlutoTool[];
  call(name: string, args?: unknown): Promise<CallToolResult>;
  registerOn(server: McpServer): void;
}

export function createPlutoTools(manager: PlutoToolsManager): PlutoToolSet {
  const tools = [
    ...serverTools(manager),
    ...notebookTools(manager),
    ...cellTools(manager),
    ...outputTools(manager),
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    tools,
    async call(name, args = {}) {
      const found = byName.get(name);
      if (!found) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return found.call(args);
    },
    registerOn(server) {
      for (const t of tools) {
        server.registerTool(
          t.name,
          { description: t.description, inputSchema: t.shape },
          (args) => t.call(args)
        );
      }
    },
  };
}
