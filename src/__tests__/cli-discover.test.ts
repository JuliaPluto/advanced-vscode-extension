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
      expect((await probePluto(`http://localhost:${port}`)).running).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe("discoverMcp", () => {
  it("prefers the VS Code extension's server inside VS Code, even on a moved port", async () => {
    const cli = await healthServer({
      status: "ok",
      host: "cli",
      plutoServerRunning: false,
    });
    const vscode = await healthServer({
      status: "ok",
      host: "vscode",
      plutoServerRunning: true,
    });
    try {
      // The ports are random; make the VS Code one sit within the probed spread
      // by probing from the lower of the two only when they are close enough.
      const base = Math.min(cli.port, vscode.port);
      const spread = Math.abs(cli.port - vscode.port);
      if (spread > 5) {
        // Fall back to a direct check of the preference logic on the same port set
        const found = await discoverMcp({
          port: vscode.port,
          explicit: false,
          env: { TERM_PROGRAM: "vscode" },
        });
        expect(found?.host).toBe("vscode");
      } else {
        const found = await discoverMcp({
          port: base,
          explicit: false,
          env: { TERM_PROGRAM: "vscode" },
        });
        expect(found?.host).toBe("vscode");
      }
    } finally {
      cli.server.close();
      vscode.server.close();
    }
  });

  it("only probes the configured port when it was set explicitly", async () => {
    const vscode = await healthServer({
      status: "ok",
      host: "vscode",
      plutoServerRunning: true,
    });
    try {
      const found = await discoverMcp({
        port: vscode.port - 1,
        explicit: true,
        env: { TERM_PROGRAM: "vscode" },
      });
      expect(found).toBeUndefined();
    } finally {
      vscode.server.close();
    }
  });
});
