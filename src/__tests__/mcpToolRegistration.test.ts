import * as fs from "fs";
import * as path from "path";
import { jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolvePathArgs } from "../cli/toolArgs.js";
import type { ToolInfo } from "../cli/toolClient.js";
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

  it("marks every file argument, so the CLI resolves exactly those", async () => {
    const { tools } = await sessions[0].listTools();
    const marked = new Set<string>();
    for (const t of tools) {
      const properties = (t.inputSchema.properties ?? {}) as Record<
        string,
        { type?: string; "x-pluto-path"?: boolean }
      >;
      const strings = Object.keys(properties).filter(
        (name) => properties[name].type === "string"
      );
      const resolved = resolvePathArgs(
        Object.fromEntries(strings.map((name) => [name, "rel"])),
        t as ToolInfo,
        "/cwd"
      );
      for (const name of strings) {
        const isPath = resolved[name] === "/cwd/rel";
        expect({ tool: t.name, name, isPath }).toEqual({
          tool: t.name,
          name,
          isPath: !!properties[name]["x-pluto-path"],
        });
        if (isPath) marked.add(name);
      }
    }
    expect(marked).toContain("path");
  });

  it("lists every tool in the package README, and nothing else", () => {
    const readme = fs.readFileSync(
      path.join(process.cwd(), "packages/advanced-pluto-mcp/README.md"),
      "utf-8"
    );
    const section = readme.split("## Notebook tools")[1].split("\n## ")[0];
    const documented = [...section.matchAll(/^\| `(\w+)`/gm)].map((m) => m[1]);
    const names = toolSet.createPlutoTools(manager).tools.map((t) => t.name);
    expect([...documented].sort()).toEqual([...names].sort());
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
