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

/** Start the real HTTP server and connect a client the way a host would. */
async function connect(): Promise<Client> {
  const port = await findAvailablePort(3400);
  initializeMCPServer(plutoManager, port, outputChannel, "1.2.3");
  await startMCPServer(outputChannel);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://localhost:${getMCPServer()!.getPort()}/mcp`)
    )
  );
  return client;
}

describe("the server's instructions", () => {
  afterEach(async () => {
    await stopMCPServer();
    cleanupMCPServer();
  });

  it("reach the client with the handshake, before any tool is read", async () => {
    const client = await connect();

    expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(client.getServerVersion()).toEqual(
      expect.objectContaining({ version: "1.2.3" })
    );

    await client.close();
  });

  it("names only tools this server registers", async () => {
    const client = await connect();
    const registered = new Set(
      (await client.listTools()).tools.map((tool) => tool.name)
    );

    const named = new Set(
      MCP_SERVER_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []
    );
    named.delete("timed_out");

    expect([...named].filter((name) => !registered.has(name))).toEqual([]);
    expect(named.size).toBeGreaterThan(5);

    await client.close();
  });
});

describe("the instructions text", () => {
  // Sent on every session, so it stays a summary of what a client cannot
  // afford to learn by trying; the full guide is behind learn_pluto_basics.
  it("carries the rules that cost a caller before a tool description can", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("Nothing is auto-saved");
    expect(MCP_SERVER_INSTRUCTIONS).toContain(
      "A create_cell that timed out still created its cell"
    );
    expect(MCP_SERVER_INSTRUCTIONS).toContain(
      "defined in exactly one cell, notebook-wide"
    );
    expect(MCP_SERVER_INSTRUCTIONS).toContain(
      "Path arguments must be absolute"
    );
    expect(MCP_SERVER_INSTRUCTIONS).toContain(
      "Once any cell calls Pkg.activate"
    );
  });

  it("stays shorter than the guide it points at", () => {
    expect(MCP_SERVER_INSTRUCTIONS.length).toBeLessThan(4000);
  });
});
