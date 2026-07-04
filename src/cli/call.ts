/**
 * MCP tool caller — connects to a running MCP server via SSE,
 * sends JSON-RPC requests, and prints responses.
 * Uses raw fetch + SSE parsing to avoid eventsource polyfill issues in CJS bundles.
 */

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    tools?: Array<{
      name: string;
      description?: string;
      inputSchema?: { properties?: Record<string, unknown> };
    }>;
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

async function mcpRequest(
  port: number,
  method: string,
  params: Record<string, unknown> = {}
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
        clientInfo: { name: "plutojl-mcp-cli", version: "0.1.0" },
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
  const timeout = setTimeout(() => {
    reader.cancel().catch(() => {});
  }, 30000);

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

  throw new Error("No response received from MCP server");
}

export async function listTools(port: number): Promise<void> {
  const result = await mcpRequest(port, "tools/list");
  const tools = result?.tools ?? [];

  if (tools.length === 0) {
    console.log("No tools available.");
    return;
  }

  const maxLen = Math.max(...tools.map((t) => t.name.length));

  for (const tool of tools) {
    const params = tool.inputSchema?.properties
      ? Object.keys(tool.inputSchema.properties)
      : [];
    const paramStr = params.length > 0 ? `  (${params.join(", ")})` : "";
    console.log(
      `  ${tool.name.padEnd(maxLen)}  ${tool.description ?? ""}${paramStr}`
    );
  }
}

export async function callTool(
  port: number,
  toolName: string,
  argsJson: string,
  raw: boolean
): Promise<void> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    console.error(`Invalid JSON arguments: ${argsJson}`);
    process.exit(1);
  }

  const result = await mcpRequest(port, "tools/call", {
    name: toolName,
    arguments: args,
  });

  if (raw) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const content = result?.content as
    | Array<{ type: string; text?: string }>
    | undefined;
  if (content) {
    for (const item of content) {
      if (item.type === "text" && item.text) {
        console.log(item.text);
      }
    }
  }

  if (result?.isError) {
    process.exit(1);
  }
}
