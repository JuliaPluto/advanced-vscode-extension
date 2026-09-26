/**
 * Client side of the tool server's protocol: one MCP session over
 * Streamable HTTP, opened once per command and closed when it is done.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "./config.ts";

export interface ToolSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: ToolSchema;
  /** Set on string arguments that name a file. */
  "x-pluto-path"?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, ToolSchema>;
    required?: string[];
  };
}

export interface ToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResult {
  content?: ToolContent[];
  isError?: boolean;
}

export interface ToolClient {
  listTools(): Promise<ToolInfo[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<ToolResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SESSION_END_TIMEOUT_MS = 2_000;

function describeConnectError(url: URL, e: unknown): Error {
  if (e instanceof StreamableHTTPError && (e.code === 404 || e.code === 405)) {
    return new Error(
      `The tool server at ${url} does not speak Streamable HTTP. ` +
        `Update it (VS Code extension 0.3.0+, or a current 'npx @plutojl/cli run').`
    );
  }
  const message = e instanceof Error ? e.message : String(e);
  return new Error(
    `Failed to connect to the tool server at ${url}: ${message}`
  );
}

function describeRequestError(what: string, timeoutMs: number, e: unknown) {
  if (e instanceof McpError && e.code === ErrorCode.RequestTimeout) {
    return new Error(
      `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}. ` +
        `The operation may still be running on the server — pass --timeout <seconds> to wait longer.`
    );
  }
  return e;
}

/**
 * Run `use` with a client connected to the tool server on `port`. The
 * session is terminated afterwards, whether `use` succeeds or throws, and
 * on SIGINT before the process exits; neither waits more than
 * SESSION_END_TIMEOUT_MS for the server.
 */
export async function withToolClient<T>(
  port: number,
  use: (client: ToolClient) => Promise<T>
): Promise<T> {
  const url = new URL(`http://localhost:${port}/mcp`);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: "plutojl-cli", version: VERSION });
  try {
    await client.connect(transport);
  } catch (e) {
    await client.close().catch(() => {});
    throw describeConnectError(url, e);
  }

  const toolClient: ToolClient = {
    async listTools() {
      try {
        const { tools } = await client.listTools(undefined, {
          timeout: DEFAULT_TIMEOUT_MS,
        });
        return tools as ToolInfo[];
      } catch (e) {
        throw describeRequestError("tools/list", DEFAULT_TIMEOUT_MS, e);
      }
    },
    async callTool(name, args, timeoutMs) {
      try {
        return (await client.callTool({ name, arguments: args }, undefined, {
          timeout: timeoutMs,
        })) as ToolResult;
      } catch (e) {
        throw describeRequestError(name, timeoutMs, e);
      }
    },
  };

  const endSession = async () => {
    await Promise.race([
      transport.terminateSession().catch(() => {}),
      new Promise((resolve) =>
        setTimeout(resolve, SESSION_END_TIMEOUT_MS).unref()
      ),
    ]);
    await client.close().catch(() => {});
  };
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    void endSession().finally(() => process.exit(130));
  };
  process.once("SIGINT", onInterrupt);

  try {
    return await use(toolClient);
  } finally {
    process.off("SIGINT", onInterrupt);
    if (interrupted) {
      // The interrupt handler owns the exit; the failed request must not
      // reach the caller's error reporting first.
      await new Promise<never>(() => {});
    }
    await endSession();
  }
}
