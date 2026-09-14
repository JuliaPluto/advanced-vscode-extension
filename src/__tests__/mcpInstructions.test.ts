import { readFileSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_SERVER_INSTRUCTIONS } from "../mcpInstructions.ts";
import {
  cleanupMCPServer,
  getMCPServer,
  initializeMCPServer,
  startMCPServer,
  stopMCPServer,
} from "../mcp-server-http.ts";
import { findAvailablePort } from "../portUtils.ts";
import type { PlutoManager } from "../plutoManager.ts";

const outputChannel = { appendLine: () => {} };

const plutoManager = {
  isRunning: () => false,
  isConnected: () => false,
} as unknown as PlutoManager;

/**
 * Snake_case words in the prose that name a field or setting rather than a
 * tool. Anything outside this set has to be a tool the server registers.
 */
const NON_TOOL_TERMS = ["timed_out"];

describe("the server's instructions", () => {
  let client: Client;

  beforeAll(async () => {
    const port = await findAvailablePort(3400);
    initializeMCPServer(plutoManager, port, outputChannel, "1.2.3");
    await startMCPServer(outputChannel);
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost:${getMCPServer()!.getPort()}/mcp`)
      )
    );
  });

  afterAll(async () => {
    await client.close();
    await stopMCPServer();
    cleanupMCPServer();
  });

  it("reaches the client with the handshake, before any tool is read", () => {
    expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(client.getServerVersion()).toEqual(
      expect.objectContaining({ version: "1.2.3" })
    );
  });

  it("names only tools this server registers", async () => {
    const registered = new Set(
      (await client.listTools()).tools.map((tool) => tool.name)
    );
    const mentioned = MCP_SERVER_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g);

    // A term excused here would otherwise mask a tool that no longer exists
    expect(NON_TOOL_TERMS.filter((term) => registered.has(term))).toEqual([]);
    expect(
      [...new Set(mentioned)].filter(
        (name) => !registered.has(name) && !NON_TOOL_TERMS.includes(name)
      )
    ).toEqual([]);
  });

  it("summarizes the guide it points at rather than restating it", () => {
    const guide = readFileSync(
      new URL("../PLUTO_GUIDE.md", import.meta.url),
      "utf8"
    );
    expect(MCP_SERVER_INSTRUCTIONS.length).toBeLessThan(guide.length / 4);
  });
});
