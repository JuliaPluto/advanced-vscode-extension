import * as http from "http";
import type { AddressInfo } from "net";
import {
  discoverMcp,
  isInsideVSCode,
  probeMcp,
  probePluto,
} from "../cli/discover.ts";

function serve(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function healthServer(body: Record<string, unknown>) {
  return serve((req, res) => {
    if (req.url === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
}

describe("isInsideVSCode", () => {
  it("detects VS Code terminals and their children", () => {
    expect(isInsideVSCode({})).toBe(false);
    expect(isInsideVSCode({ TERM_PROGRAM: "vscode" })).toBe(true);
    expect(isInsideVSCode({ VSCODE_PID: "123" })).toBe(true);
    expect(isInsideVSCode({ VSCODE_IPC_HOOK_CLI: "/tmp/x.sock" })).toBe(true);
    expect(isInsideVSCode({ TERM_PROGRAM: "iTerm.app" })).toBe(false);
  });
});

describe("probeMcp", () => {
  it("reads the host and Pluto state from /health", async () => {
    const { server, port } = await healthServer({
      status: "ok",
      host: "vscode",
      version: "0.3.1",
      plutoServerRunning: true,
      plutoUrl: "http://localhost:1234",
      activeSessions: 2,
    });
    try {
      expect(await probeMcp(port)).toEqual({
        port,
        url: `http://localhost:${port}/mcp`,
        host: "vscode",
        version: "0.3.1",
        plutoRunning: true,
        plutoUrl: "http://localhost:1234",
        sessions: 2,
      });
    } finally {
      server.close();
    }
  });

  it("ignores servers that are not a Pluto tool server", async () => {
    const { server, port } = await serve((_req, res) => {
      res.end("hello");
    });
    try {
      expect(await probeMcp(port)).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("returns undefined when nothing listens", async () => {
    const { server, port } = await serve(() => {});
    server.close();
    expect(await probeMcp(port)).toBeUndefined();
  });
});

describe("probePluto", () => {
  it("recognises Pluto's index page", async () => {
    const { server, port } = await serve((_req, res) => {
      res.end("<html><title>⚡ Pluto.jl ⚡</title></html>");
    });
    try {
      expect(await probePluto(`http://localhost:${port}`)).toEqual({
        url: `http://localhost:${port}`,
        running: true,
      });
    } finally {
      server.close();
    }
  });

  it("reports not running for other servers or closed ports", async () => {
    const { server, port } = await serve((_req, res) => {
      res.end("nginx");
    });
    try {
      expect((await probePluto(`http://localhost:${port}`)).running).toBe(
        false
      );
    } finally {
      server.close();
    }
  });
});

describe("discoverMcp", () => {
  it("uses whatever answers on the configured port, even inside VS Code", async () => {
    const cli = await healthServer({
      status: "ok",
      host: "cli",
      plutoServerRunning: false,
    });
    try {
      const found = await discoverMcp({
        port: cli.port,
        explicit: false,
        env: { TERM_PROGRAM: "vscode" },
      });
      expect(found?.host).toBe("cli");
      expect(found?.port).toBe(cli.port);
    } finally {
      cli.server.close();
    }
  });

  it("looks above the configured port inside VS Code when nothing answers on it", async () => {
    const vscode = await healthServer({
      status: "ok",
      host: "vscode",
      plutoServerRunning: true,
    });
    try {
      const found = await discoverMcp({
        port: vscode.port - 3,
        explicit: false,
        env: { TERM_PROGRAM: "vscode" },
      });
      expect(found?.port).toBe(vscode.port);
      expect(found?.host).toBe("vscode");
    } finally {
      vscode.server.close();
    }
  });

  it("does not scan outside VS Code or when the port was given explicitly", async () => {
    const vscode = await healthServer({
      status: "ok",
      host: "vscode",
      plutoServerRunning: true,
    });
    try {
      expect(
        await discoverMcp({ port: vscode.port - 1, explicit: false, env: {} })
      ).toBeUndefined();
      expect(
        await discoverMcp({
          port: vscode.port - 1,
          explicit: true,
          env: { TERM_PROGRAM: "vscode" },
        })
      ).toBeUndefined();
    } finally {
      vscode.server.close();
    }
  });
});
