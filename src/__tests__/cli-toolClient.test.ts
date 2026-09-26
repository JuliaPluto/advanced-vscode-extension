import * as http from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { jest } from "@jest/globals";
import { z } from "zod";
import { withToolClient } from "../cli/toolClient.ts";

interface FakeServer {
  port: number;
  sessions: Map<string, StreamableHTTPServerTransport>;
  close(): Promise<void>;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

function stop(server: http.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

function toolServer(): McpServer {
  const server = new McpServer({ name: "fake", version: "0.0.0" });
  server.tool(
    "echo",
    "Echo the text back.",
    { text: z.string() },
    async ({ text }) => ({ content: [{ type: "text", text }] })
  );
  server.tool("fail", "Always fails.", {}, async () => ({
    content: [{ type: "text", text: "it failed" }],
    isError: true,
  }));
  server.tool(
    "slow",
    "Takes a while.",
    {},
    () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ content: [{ type: "text", text: "late" }] }),
          2000
        )
      )
  );
  return server;
}

async function streamableServer(
  opts: { ignoreDelete?: boolean } = {}
): Promise<FakeServer> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const httpServer = http.createServer(async (req, res) => {
    if (opts.ignoreDelete && req.method === "DELETE") {
      return;
    }
    const id = req.headers["mcp-session-id"] as string | undefined;
    let transport = id ? sessions.get(id) : undefined;
    if (!transport) {
      if (id) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, created);
        },
      });
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId);
      };
      await toolServer().connect(created);
      transport = created;
    }
    await transport.handleRequest(req, res);
  });
  const port = await listen(httpServer);
  return { port, sessions, close: () => stop(httpServer) };
}

describe("withToolClient", () => {
  let server: FakeServer;

  beforeEach(async () => {
    server = await streamableServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("lists tools with their input schemas", async () => {
    const tools = await withToolClient(server.port, (c) => c.listTools());
    expect(tools.map((t) => t.name)).toEqual(["echo", "fail", "slow"]);
    const echo = tools.find((t) => t.name === "echo");
    expect(echo?.inputSchema?.required).toEqual(["text"]);
    expect(echo?.inputSchema?.properties?.text?.type).toBe("string");
  });

  it("returns a tool result verbatim, including JSON-RPC-looking text", async () => {
    const text = '{"jsonrpc":"2.0","id":0,"result":"initialize"}';
    const result = await withToolClient(server.port, (c) =>
      c.callTool("echo", { text }, 5000)
    );
    expect(result.content).toEqual([{ type: "text", text }]);
    expect(result.isError).toBeFalsy();
  });

  it("reports tool errors as isError results", async () => {
    const result = await withToolClient(server.port, (c) =>
      c.callTool("fail", {}, 5000)
    );
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe("it failed");
  });

  it("uses one session for several requests and terminates it", async () => {
    let seen = 0;
    await withToolClient(server.port, async (c) => {
      await c.listTools();
      await c.callTool("echo", { text: "a" }, 5000);
      seen = server.sessions.size;
    });
    expect(seen).toBe(1);
    expect(server.sessions.size).toBe(0);
  });

  it("terminates the session when the caller throws", async () => {
    await expect(
      withToolClient(server.port, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(server.sessions.size).toBe(0);
  });

  it("names the timeout and how to extend it", async () => {
    await expect(
      withToolClient(server.port, (c) => c.callTool("slow", {}, 1000))
    ).rejects.toThrow(/Timed out after 1s waiting for slow.*--timeout/);
  });
});

describe("withToolClient ending the session", () => {
  it("does not wait long for a server that never answers the DELETE", async () => {
    const server = await streamableServer({ ignoreDelete: true });
    try {
      const started = Date.now();
      const tools = await withToolClient(server.port, (c) => c.listTools());
      expect(tools).toHaveLength(3);
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await server.close();
    }
  });

  it("ends the session on SIGINT and exits with 130", async () => {
    const server = await streamableServer();
    let exited: (code: number | undefined) => void = () => {};
    const exitCode = new Promise<number | undefined>((r) => (exited = r));
    const exit = jest
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        exited(code === null ? undefined : Number(code));
        return undefined as never;
      });
    try {
      let sessionsDuringCall = 0;
      void withToolClient(server.port, async (c) => {
        const call = c.callTool("slow", {}, 5000);
        sessionsDuringCall = server.sessions.size;
        process.emit("SIGINT");
        return call;
      });
      expect(await exitCode).toBe(130);
      expect(sessionsDuringCall).toBe(1);
      expect(server.sessions.size).toBe(0);
      expect(process.listenerCount("SIGINT")).toBe(0);
    } finally {
      exit.mockRestore();
      await server.close();
    }
  });
});

describe("withToolClient against servers that cannot serve it", () => {
  it("says so when the server only speaks the legacy SSE transport", async () => {
    const legacy = http.createServer((req, res) => {
      res.statusCode = req.method === "POST" ? 404 : 200;
      res.end();
    });
    const port = await listen(legacy);
    try {
      await expect(withToolClient(port, (c) => c.listTools())).rejects.toThrow(
        /does not speak Streamable HTTP/
      );
    } finally {
      await stop(legacy);
    }
  });

  it("names the url when nothing listens", async () => {
    const gone = http.createServer();
    const port = await listen(gone);
    await stop(gone);
    await expect(withToolClient(port, (c) => c.listTools())).rejects.toThrow(
      `tool server at http://localhost:${port}/mcp`
    );
  });
});
