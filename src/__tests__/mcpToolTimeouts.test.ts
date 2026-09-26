import { jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PlutoMCPHttpServer } from "../mcp-server-http.js";
import type { PlutoManager } from "../plutoManager.js";

const EXECUTION_TIMEOUT_MS = 5 * 60_000;
const DOCS_TIMEOUT_MS = 30_000;
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

  async function callAfter(
    ms: number,
    name: string,
    args: Record<string, unknown>
  ) {
    const call = client.callTool({ name, arguments: args }, undefined, {
      timeout: 2 * EXECUTION_TIMEOUT_MS,
    });
    await jest.advanceTimersByTimeAsync(ms);
    const result = await call;
    const [content] = result.content as Array<{ type: string; text: string }>;
    return { isError: result.isError, text: content.text };
  }

  it.each([
    ["execute_cell", { path: "/nb.jl", cell_id: "c1" }, { cell_id: "c1" }],
    ["create_cell", { path: "/nb.jl", code: "x = 1" }, {}],
    ["execute_code", { path: "/nb.jl", code: "x" }, {}],
    [
      "edit_cell",
      { path: "/nb.jl", cell_id: "c1", code: "x = 1" },
      { cell_id: "c1" },
    ],
    [
      "read_cell_output",
      { path: "/nb.jl", cell_id: "c1", as: "image" },
      { cell_id: "c1" },
    ],
    [
      "read_cell_output",
      { path: "/nb.jl", cell_id: "c1", as: "file", output_path: "/x.png" },
      { cell_id: "c1" },
    ],
  ])(
    "%s returns timed_out after the execution timeout",
    async (name, args, ids) => {
      const result = await callAfter(EXECUTION_TIMEOUT_MS, name, args);

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.text)).toMatchObject({
        ...ids,
        timed_out: true,
        message: expect.stringContaining("wait_for_notebook_idle"),
      });
    }
  );

  it("get_docs fails as a stalled connection after the docs timeout", async () => {
    const result = await callAfter(DOCS_TIMEOUT_MS, "get_docs", {
      path: "/nb.jl",
      symbol: "x",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("'x'");
    expect(result.text).toContain("may be stalled");
  });

  it("introspect_notebook lists symbols without the docs that timed out", async () => {
    const result = await callAfter(DOCS_TIMEOUT_MS, "introspect_notebook", {
      path: "/nb.jl",
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.text);
    expect(body.symbols).toEqual([{ symbol: "x" }]);
    expect(body.message).toContain("did not answer 1 documentation request");
    expect(body.message).toContain("may be stalled");
  });
});
