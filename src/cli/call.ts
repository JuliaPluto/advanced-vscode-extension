/**
 * MCP tool caller — connects to a running MCP server via SSE,
 * sends JSON-RPC requests, and prints responses.
 * Uses raw fetch + SSE parsing to avoid eventsource polyfill issues in CJS bundles.
 */

import { VERSION } from "./config.ts";
import { bold, cyan, dim, red, yellow } from "./ui.ts";

interface ToolSchema {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
}

interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, ToolSchema>;
    required?: string[];
  };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    tools?: ToolInfo[];
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

async function mcpRequest(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30000
): Promise<JsonRpcResponse["result"]> {
  const sseUrl = `http://localhost:${port}/mcp`;

  // 1. Open SSE connection to get session endpoint
  const sseResponse = await fetch(sseUrl, {
    headers: { Accept: "text/event-stream" },
  });

  if (!sseResponse.ok || !sseResponse.body) {
    throw new Error(
      `Failed to connect to MCP server at ${sseUrl} (${sseResponse.status})`
    );
  }

  const reader = sseResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sessionUrl: string | undefined;

  // Read until we get the endpoint event
  while (!sessionUrl) {
    const { done, value } = await reader.read();
    if (done) throw new Error("SSE stream ended before receiving endpoint");
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (line.startsWith("data: ") && !sessionUrl) {
        sessionUrl = line.slice(6).trim();
      }
    }
    buffer = lines[lines.length - 1];
  }

  const messagesUrl = `http://localhost:${port}${sessionUrl}`;
  const requestId = 1;

  // 2. First send initialize
  await fetch(messagesUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "plutojl-cli", version: VERSION },
      },
    }),
  });

  // Read and discard the initialize response
  let initDone = false;
  while (!initDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes('"initialize"') || buffer.includes('"id":0')) {
      initDone = true;
    }
  }

  // Send initialized notification
  await fetch(messagesUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  // 3. Send the actual request
  await fetch(messagesUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    }),
  });

  // 4. Read SSE events until we get our response
  buffer = "";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        let eventData = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("data: ")) {
            eventData += line.slice(6);
          }
        }
        if (eventData) {
          try {
            const parsed = JSON.parse(eventData) as JsonRpcResponse;
            if (parsed.id === requestId) {
              if (parsed.error) {
                throw new Error(
                  `MCP error ${parsed.error.code}: ${parsed.error.message}`
                );
              }
              return parsed.result;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // not JSON, skip
            throw e;
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.cancel().catch(() => {});
  }

  if (timedOut) {
    throw new Error(
      `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${method}. ` +
        `The operation may still be running on the server — pass --timeout <seconds> to wait longer.`
    );
  }
  throw new Error("No response received from MCP server");
}

/** First sentence of a description, for the one-line listing. */
function summary(text: string | undefined): string {
  if (!text) return "";
  const match = /^(.+?[.!?])(\s|$)/.exec(text);
  return match ? match[1] : text;
}

function describeTool(tool: ToolInfo): string {
  const lines = [bold(tool.name)];
  if (tool.description) {
    lines.push(`  ${tool.description}`);
  }
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const names = Object.keys(props);
  lines.push("");
  if (names.length === 0) {
    lines.push(`  ${dim("no parameters")}`);
  } else {
    lines.push(`  ${dim("Parameters")}`);
    const width = Math.max(...names.map((n) => n.length));
    for (const name of names) {
      const schema = props[name];
      const type = schema.enum
        ? schema.enum.map(String).join(" | ")
        : (schema.type ?? "any");
      const flags = [
        required.has(name) ? yellow("required") : "",
        schema.default !== undefined
          ? dim(`default ${JSON.stringify(schema.default)}`)
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `    ${cyan(name.padEnd(width))}  ${dim(type)}${flags ? "  " + flags : ""}`
      );
      if (schema.description) {
        lines.push(`    ${" ".repeat(width)}  ${schema.description}`);
      }
    }
  }
  lines.push("");
  const example: Record<string, unknown> = {};
  for (const name of names) {
    if (required.has(name)) {
      example[name] = props[name].type === "number" ? 0 : `<${name}>`;
    }
  }
  lines.push(
    `  ${dim("Example")}  npx @plutojl/cli call ${tool.name}${
      names.length ? ` '${JSON.stringify(example)}'` : ""
    }`
  );
  return lines.join("\n");
}

export async function listTools(port: number, filter?: string): Promise<void> {
  const result = await mcpRequest(port, "tools/list");
  const tools = result?.tools ?? [];

  if (filter) {
    const tool = tools.find((t) => t.name === filter);
    if (!tool) {
      const close = tools
        .filter((t) => t.name.includes(filter))
        .map((t) => t.name);
      console.error(
        `${red("error:")} no tool named '${filter}'` +
          (close.length ? `. Did you mean: ${close.join(", ")}?` : "")
      );
      process.exit(1);
    }
    console.log(describeTool(tool));
    return;
  }

  if (tools.length === 0) {
    console.log("No tools available.");
    return;
  }

  const maxLen = Math.max(...tools.map((t) => t.name.length));
  for (const tool of tools) {
    const params = Object.keys(tool.inputSchema?.properties ?? {});
    const paramStr = params.length > 0 ? dim(`  (${params.join(", ")})`) : "";
    console.log(
      `  ${cyan(tool.name.padEnd(maxLen))}  ${summary(tool.description)}${paramStr}`
    );
  }
  console.log(dim(`\n  npx @plutojl/cli tools <name> shows a tool's parameters.`));
}

export async function callTool(
  port: number,
  toolName: string,
  argsJson: string,
  raw: boolean,
  timeoutMs = 120000
): Promise<void> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    console.error(
      `${red("error:")} tool arguments must be a JSON object, got: ${argsJson}`
    );
    console.error(dim(`  e.g. npx @plutojl/cli call ${toolName} '{"path": "nb.pluto.jl"}'`));
    process.exit(1);
  }

  const result = await mcpRequest(
    port,
    "tools/call",
    {
      name: toolName,
      arguments: args,
    },
    timeoutMs
  );

  if (raw) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const item of result?.content ?? []) {
      if (item.type === "text" && item.text) {
        console.log(item.text);
      }
    }
  }

  if (result?.isError) {
    process.exit(1);
  }
}
