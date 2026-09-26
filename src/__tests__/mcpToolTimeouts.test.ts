import { jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PlutoMCPHttpServer } from "../mcp-server-http.js";
import type { PlutoManager } from "../plutoManager.js";

const EXECUTION_TIMEOUT_MS = 5 * 60_000;
const never = () => new Promise<never>(() => {});

const worker = {
  getSnippet: () => ({
    result: { output: { mime: "image/svg+xml", body: "<svg/>" } },
  }),
  getDocs: never,
  getState: () => ({
    cell_order: ["c1"],
    cell_dependencies: { c1: { downstream_cells_map: { x: [] } } },
  }),
};

const plutoManager = {
  isConnected: () => true,
  isLocalServer: () => true,
  getWorker: async () => worker,
  runCell: never,
  runSnippet: never,
  executeCell: never,
  executeCodeEphemeral: never,
} as unknown as PlutoManager;

async function connectClient(): Promise<Client> {
  const httpServer = new PlutoMCPHttpServer(plutoManager, 0, {
    version: "test",
  });
  const server = (
    httpServer as unknown as { createMcpServer(): McpServer }
  ).createMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

describe("blocking tools are bounded by the execution timeout", () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });
  afterAll(async () => {
    await client.close();
  });
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["execute_cell", { path: "/nb.jl", cell_id: "c1" }],
    ["create_cell", { path: "/nb.jl", code: "x = 1" }],
    ["execute_code", { path: "/nb.jl", code: "x" }],
    ["edit_cell", { path: "/nb.jl", cell_id: "c1", code: "x = 1" }],
    ["get_docs", { path: "/nb.jl", symbol: "x" }],
    ["introspect_notebook", { path: "/nb.jl" }],
    ["read_cell_output", { path: "/nb.jl", cell_id: "c1", as: "image" }],
    [
      "read_cell_output",
      { path: "/nb.jl", cell_id: "c1", as: "file", output_path: "/x.png" },
    ],
  ])("%s returns timed_out instead of blocking", async (name, args) => {
    const call = client.callTool({ name, arguments: args }, undefined, {
      timeout: 2 * EXECUTION_TIMEOUT_MS,
    });

    await jest.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS);
    const result = await call;

    const [content] = result.content as Array<{ type: string; text: string }>;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(content.text)).toMatchObject({ timed_out: true });
  });
});
