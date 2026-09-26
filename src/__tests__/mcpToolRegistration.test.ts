import { jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolvePathArgs } from "../cli/toolArgs.js";
import type { PlutoManager } from "../plutoManager.js";
import * as toolSet from "../mcpTools/index.js";
import { fakePlutoManager, textOf } from "./helpers/fakePlutoManager.js";

const createPlutoTools = jest.fn(toolSet.createPlutoTools);
jest.unstable_mockModule("../mcpTools/index.js", () => ({
  ...toolSet,
  createPlutoTools,
}));
const { PlutoMCPHttpServer } = await import("../mcp-server-http.js");
type PlutoMCPHttpServer = InstanceType<typeof PlutoMCPHttpServer>;

async function connect(httpServer: PlutoMCPHttpServer): Promise<Client> {
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

describe("MCP registration", () => {
  const manager = fakePlutoManager();
  const httpServer = new PlutoMCPHttpServer(
    manager as unknown as PlutoManager,
    0,
    { version: "test" }
  );
  let sessions: Client[];

  beforeAll(async () => {
    sessions = [await connect(httpServer), await connect(httpServer)];
  });
  afterAll(async () => {
    await Promise.all(sessions.map((c) => c.close()));
  });

  it("builds the tool set once for every session", () => {
    expect(createPlutoTools).toHaveBeenCalledTimes(1);
    expect(createPlutoTools).toHaveBeenCalledWith(manager);
  });

  it("lists every tool of the set in every session", async () => {
    const names = toolSet.createPlutoTools(manager).tools.map((t) => t.name);
    expect(names).toHaveLength(25);
    for (const client of sessions) {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(names);
    }
  });

  it("calls a tool through the protocol", async () => {
    const result = await sessions[0].callTool({
      name: "get_notebook_url",
      arguments: { path: "/nb.jl" },
    });
    expect(textOf(result as { content: unknown })).toBe(
      "http://localhost:1234/edit?id=nb-1"
    );
  });

  it("marks exactly the arguments the CLI resolves as paths", async () => {
    const { tools } = await sessions[0].listTools();
    for (const t of tools) {
      const properties = (t.inputSchema.properties ?? {}) as Record<
        string,
        { type?: string; "x-pluto-path"?: boolean }
      >;
      for (const [name, schema] of Object.entries(properties)) {
        if (schema.type !== "string") continue;
        const resolved = resolvePathArgs({ [name]: "rel" }, "/cwd")[name];
        expect({
          tool: t.name,
          name,
          marked: !!schema["x-pluto-path"],
        }).toEqual({ tool: t.name, name, marked: resolved === "/cwd/rel" });
      }
    }
  });

  it("declares path once, with one description", async () => {
    const { tools } = await sessions[0].listTools();
    const descriptions = new Set(
      tools
        .map(
          (t) =>
            (
              t.inputSchema.properties as Record<
                string,
                { description?: string }
              >
            )?.path
        )
        .filter(Boolean)
        .map((p) => p.description)
    );
    expect([...descriptions]).toEqual([
      "Absolute path of the notebook's .jl file",
    ]);
  });
});
