import { jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PlutoMCPHttpServer } from "../mcp-server-http.js";
import type { PlutoManager } from "../plutoManager.js";
import { otherPlutoServerMessage, sameUrl } from "../plutoServerUrl.js";

const CONFIGURED = "http://localhost:1234";

function createPlutoManager(connected: boolean) {
  const manager = {
    connected,
    status: "stopped",
    isConnected: () => manager.connected,
    getState: () => ({ status: manager.status }),
    start: jest.fn(async () => {}),
    getServerUrl: () => CONFIGURED,
    connect: jest.fn(async () => {
      manager.connected = true;
    }),
  };
  return manager;
}

async function connectClient(plutoManager: unknown): Promise<Client> {
  const httpServer = new PlutoMCPHttpServer(plutoManager as PlutoManager, 0, {
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

async function callConnect(
  plutoManager: unknown,
  args: Record<string, unknown>
): Promise<{ isError: boolean; text: string }> {
  const client = await connectClient(plutoManager);
  try {
    const result = await client.callTool({
      name: "connect_to_pluto_server",
      arguments: args,
    });
    const [content] = result.content as Array<{ text: string }>;
    return { isError: !!result.isError, text: content.text };
  } finally {
    await client.close();
  }
}

describe("sameUrl", () => {
  it("ignores a trailing slash and host case", () => {
    expect(sameUrl("http://LOCALHOST:1234/", "http://localhost:1234")).toBe(
      true
    );
  });
  it("tells different ports apart", () => {
    expect(sameUrl("http://localhost:1235", "http://localhost:1234")).toBe(
      false
    );
  });
});

describe("connect_to_pluto_server", () => {
  it("connects to the configured server without a url", async () => {
    const manager = createPlutoManager(false);
    const result = await callConnect(manager, {});
    expect(result).toEqual({
      isError: false,
      text: `Connected to Pluto server at ${CONFIGURED}`,
    });
    expect(manager.connect).toHaveBeenCalledWith();
  });

  it("connects when the url names the configured server", async () => {
    const manager = createPlutoManager(false);
    const result = await callConnect(manager, { url: `${CONFIGURED}/` });
    expect(result.isError).toBe(false);
    expect(manager.connect).toHaveBeenCalledWith();
  });

  it.each([false, true])(
    "refuses a different url without connecting (connected: %s)",
    async (connected) => {
      const manager = createPlutoManager(connected);
      const result = await callConnect(manager, {
        url: "http://localhost:9999",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(
        otherPlutoServerMessage(CONFIGURED, "http://localhost:9999")
      );
      expect(result.text).not.toContain("stop_pluto_server");
      expect(manager.connect).not.toHaveBeenCalled();
    }
  );

  it("rejects a non-http url", async () => {
    const manager = createPlutoManager(false);
    const result = await callConnect(manager, { url: "file:///etc/passwd" });
    expect(result.isError).toBe(true);
    expect(manager.connect).not.toHaveBeenCalled();
  });

  it("waits for a start in flight before deciding", async () => {
    const manager = createPlutoManager(false);
    manager.status = "starting";
    manager.start = jest.fn(async () => {
      manager.connected = true;
    });
    const result = await callConnect(manager, { url: CONFIGURED });
    expect(manager.start).toHaveBeenCalled();
    expect(result.text).toBe(
      `Already connected to a Pluto server at ${CONFIGURED}`
    );
  });
});
