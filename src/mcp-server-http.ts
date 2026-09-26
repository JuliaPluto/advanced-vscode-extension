import express from "express";
import type { Express, Request, Response } from "express";
import type { Server as HttpServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { MCP_SERVER_INSTRUCTIONS } from "./mcpInstructions.ts";
import { createPlutoTools, type PlutoToolSet } from "./mcpTools/index.ts";
import type { PlutoManager } from "./plutoManager.ts";
import { isPortAvailable, findAvailablePort } from "./portUtils.ts";

// Singleton instance
let mcpServerInstance: PlutoMCPHttpServer | undefined;

/**
 * HTTP/SSE-based MCP Server for Pluto Notebooks
 * This allows the extension and MCP clients to share the same PlutoManager instance
 */
export interface McpServerOptions {
  /** Move to a free port when the requested one is busy. */
  dynamicPort?: boolean;
  /** Which program runs this server; reported by /health. */
  host?: "vscode" | "cli";
  /** Reported in the MCP handshake and by /health. */
  version: string;
}

export class PlutoMCPHttpServer {
  private readonly app: Express;
  private httpServer?: HttpServer;
  private readonly transports: Map<string, SSEServerTransport> = new Map();
  private readonly streamableTransports: Map<
    string,
    StreamableHTTPServerTransport
  > = new Map();
  // Streamable sessions are only removed via an explicit DELETE — clients
  // that crash or drop the connection leave theirs behind, so sessions
  // idle past this TTL are swept
  private readonly streamableLastActivity: Map<string, number> = new Map();
  private static readonly SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
  private sessionSweeper?: ReturnType<typeof setInterval>;
  private readonly plutoManager: PlutoManager;
  private readonly tools: PlutoToolSet;
  private port: number;
  private readonly host: "vscode" | "cli";
  private readonly version: string;
  private readonly dynamicPort: boolean;
  private readonly stateListeners = new Set<() => void>();

  /**
   * @param dynamicPort - when the configured port is busy, move to the next
   * free one instead of failing (used by the extension so multiple VSCode
   * windows can coexist; the CLI stays strict so `tools`/`call` can find it)
   */
  constructor(
    plutoManager: PlutoManager,
    port = 3100,
    options: McpServerOptions
  ) {
    this.plutoManager = plutoManager;
    this.tools = createPlutoTools(plutoManager);
    this.port = port;
    this.dynamicPort = options.dynamicPort ?? false;
    this.host = options.host ?? "vscode";
    this.version = options.version;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private createMcpServer(): McpServer {
    const server = new McpServer(
      {
        name: "pluto-notebook-mcp-server",
        version: this.version,
      },
      {
        capabilities: {
          tools: {},
        },
        instructions: MCP_SERVER_INSTRUCTIONS,
      }
    );

    this.tools.registerOn(server);

    return server;
  }

  private setupRoutes(): void {
    // Streamable HTTP (modern MCP transport): POST /mcp carries requests;
    // GET/DELETE with an mcp-session-id header manage the session stream.
    // The legacy SSE transport stays on plain GET /mcp + POST /messages.
    this.app.post("/mcp", async (req: Request, res: Response) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport = sessionId
          ? this.streamableTransports.get(sessionId)
          : undefined;

        if (!transport) {
          if (sessionId) {
            // Spec-mandated 404 so clients re-initialize after an expired
            // or restarted session instead of treating it as a bad request
            res.status(404).json({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: "Session not found",
              },
              id: null,
            });
            return;
          }
          if (!isInitializeRequest(req.body)) {
            res.status(400).json({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message:
                  "Bad Request: no valid session. Send an initialize request first.",
              },
              id: null,
            });
            return;
          }

          const newTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              console.log(`[MCP HTTP] Streamable session initialized: ${id}`);
              this.streamableTransports.set(id, newTransport);
            },
          });
          newTransport.onclose = () => {
            if (newTransport.sessionId) {
              console.log(
                `[MCP HTTP] Streamable session closed: ${newTransport.sessionId}`
              );
              this.streamableTransports.delete(newTransport.sessionId);
              this.streamableLastActivity.delete(newTransport.sessionId);
            }
          };

          const server = this.createMcpServer();
          await server.connect(newTransport);
          transport = newTransport;
        }

        await transport.handleRequest(req, res, req.body);
        if (transport.sessionId) {
          this.streamableLastActivity.set(transport.sessionId, Date.now());
        }
      } catch (error) {
        console.error("[MCP HTTP] Error handling streamable request:", error);
        if (!res.headersSent) {
          res.status(500).send("Error handling request");
        }
      }
    });

    const handleStreamableSessionRequest = async (
      req: Request,
      res: Response
    ): Promise<boolean> => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) {
        return false;
      }
      const transport = this.streamableTransports.get(sessionId);
      if (!transport) {
        res.status(404).send("Session not found");
        return true;
      }
      this.streamableLastActivity.set(sessionId, Date.now());
      await transport.handleRequest(req, res);
      return true;
    };

    this.app.delete("/mcp", async (req: Request, res: Response) => {
      try {
        if (!(await handleStreamableSessionRequest(req, res))) {
          res.status(400).send("Missing mcp-session-id header");
        }
      } catch (error) {
        console.error("[MCP HTTP] Error handling session delete:", error);
        if (!res.headersSent) {
          res.status(500).send("Error handling request");
        }
      }
    });

    // SSE endpoint for establishing the stream (legacy transport), or the
    // streamable event stream when an mcp-session-id header is present
    this.app.get("/mcp", async (req: Request, res: Response) => {
      try {
        if (await handleStreamableSessionRequest(req, res)) {
          return;
        }
      } catch (error) {
        console.error("[MCP HTTP] Error handling streamable stream:", error);
        if (!res.headersSent) {
          res.status(500).send("Error handling request");
        }
        return;
      }

      console.log(
        "[MCP HTTP] Received GET request to /mcp (establishing SSE stream)"
      );

      try {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        this.transports.set(sessionId, transport);

        // Keep idle SSE connections alive through proxies/OS sleep — a
        // silently dropped stream loses the response of any in-flight
        // long tool call (issue #38)
        const keepalive = setInterval(() => {
          if (!res.writableEnded) {
            res.write(": keepalive\n\n");
          }
        }, 30_000);

        transport.onclose = () => {
          console.log(
            `[MCP HTTP] SSE transport closed for session ${sessionId}`
          );
          clearInterval(keepalive);
          this.transports.delete(sessionId);
        };

        const server = this.createMcpServer();
        await server.connect(transport);
        console.log(
          `[MCP HTTP] Established SSE stream with session ID: ${sessionId}`
        );
      } catch (error) {
        console.error("[MCP HTTP] Error establishing SSE stream:", error);
        if (!res.headersSent) {
          res.status(500).send("Error establishing SSE stream");
        }
      }
    });

    // Messages endpoint for receiving client JSON-RPC requests
    this.app.post("/messages", async (req: Request, res: Response) => {
      console.log("[MCP HTTP] Received POST request to /messages");

      const sessionId = req.query.sessionId as string;

      if (!sessionId) {
        console.error("[MCP HTTP] No session ID provided in request URL");
        res.status(400).send("Missing sessionId parameter");
        return;
      }

      const transport = this.transports.get(sessionId);

      if (!transport) {
        console.error(
          `[MCP HTTP] No active transport found for session ID: ${sessionId}`
        );
        res.status(404).send("Session not found");
        return;
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error("[MCP HTTP] Error handling request:", error);
        if (!res.headersSent) {
          res.status(500).send("Error handling request");
        }
      }
    });

    // Health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({
        status: "ok",
        host: this.host,
        version: this.version,
        plutoServerRunning: this.plutoManager.isConnected(),
        plutoUrl: this.plutoManager.isConnected()
          ? this.plutoManager.getServerUrl()
          : undefined,
        activeSessions: this.transports.size + this.streamableTransports.size,
        transports: {
          sse: this.transports.size,
          streamableHttp: this.streamableTransports.size,
        },
      });
    });
  }

  public async start(): Promise<void> {
    if (this.dynamicPort && !(await isPortAvailable(this.port))) {
      const fallbackPort = await findAvailablePort(this.port + 1);
      console.log(
        `[MCP HTTP] Port ${this.port} is in use (another window?), using ${fallbackPort} instead`
      );
      this.port = fallbackPort;
    }

    return await new Promise((resolve, reject) => {
      this.httpServer = this.app.listen(this.port, (error?: Error) => {
        if (error) {
          console.error("[MCP HTTP] Failed to start server:", error);
          reject(error);
        } else {
          console.log(
            `[MCP HTTP] Pluto Notebook MCP Server listening on http://localhost:${this.port}`
          );
          console.log(
            `[MCP HTTP] SSE endpoint: http://localhost:${this.port}/mcp`
          );
          console.log(
            `[MCP HTTP] Health check: http://localhost:${this.port}/health`
          );
          this.sessionSweeper = setInterval(
            () => this.sweepIdleSessions(),
            10 * 60 * 1000
          );
          this.sessionSweeper.unref?.();
          this.notifyStateChange();
          resolve();
        }
      });
    });
  }

  /**
   * Subscribe to start/stop transitions (the port may change on start).
   * Returns an unsubscribe function.
   */
  public onDidChangeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private notifyStateChange(): void {
    for (const listener of this.stateListeners) {
      try {
        listener();
      } catch (error) {
        console.error("[MCP HTTP] State listener failed:", error);
      }
    }
  }

  private sweepIdleSessions(): void {
    const cutoff = Date.now() - PlutoMCPHttpServer.SESSION_IDLE_TTL_MS;
    for (const [sessionId, transport] of this.streamableTransports.entries()) {
      const lastActivity = this.streamableLastActivity.get(sessionId) ?? 0;
      if (lastActivity < cutoff) {
        console.log(`[MCP HTTP] Sweeping idle streamable session ${sessionId}`);
        void transport.close().catch((error) => {
          console.error(
            `[MCP HTTP] Error closing idle session ${sessionId}:`,
            error
          );
          this.streamableTransports.delete(sessionId);
          this.streamableLastActivity.delete(sessionId);
        });
      }
    }
  }

  public async stop(): Promise<void> {
    console.log("[MCP HTTP] Stopping MCP server...");

    if (this.sessionSweeper) {
      clearInterval(this.sessionSweeper);
      this.sessionSweeper = undefined;
    }

    // Close all active transports
    for (const [sessionId, transport] of this.transports.entries()) {
      try {
        console.log(`[MCP HTTP] Closing transport for session ${sessionId}`);
        await transport.close();
        this.transports.delete(sessionId);
      } catch (error) {
        console.error(
          `[MCP HTTP] Error closing transport for session ${sessionId}:`,
          error
        );
      }
    }
    for (const [sessionId, transport] of this.streamableTransports.entries()) {
      try {
        await transport.close();
        this.streamableTransports.delete(sessionId);
      } catch (error) {
        console.error(
          `[MCP HTTP] Error closing streamable session ${sessionId}:`,
          error
        );
      }
    }

    // Close HTTP server (resolve immediately if it never started)
    await new Promise<void>((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.closeAllConnections?.();
      this.httpServer.close(() => {
        console.log("[MCP HTTP] HTTP server closed");
        resolve();
      });
      // Idle keep-alive connections would otherwise hold close() open
      this.httpServer.closeIdleConnections();
    });
    this.httpServer = undefined;
    this.notifyStateChange();
  }

  public getPort(): number {
    return this.port;
  }

  public isRunning(): boolean {
    return !!this.httpServer?.listening;
  }
}

/**
 * Initialize the singleton MCP server instance
 * @param plutoManager - Shared PlutoManager instance
 * @param port - Port number for the MCP server
 * @param outputChannel - Output channel for logging
 * @param version - Extension version, reported in the MCP handshake
 */
export function initializeMCPServer(
  plutoManager: PlutoManager,
  port: number,
  outputChannel: {
    appendLine: (msg: string) => void;
  },
  version: string
): void {
  if (mcpServerInstance) {
    outputChannel.appendLine("MCP server already initialized");
    return;
  }

  // Dynamic port: a second VSCode window must not fail on a busy port
  mcpServerInstance = new PlutoMCPHttpServer(plutoManager, port, {
    dynamicPort: true,
    host: "vscode",
    version,
  });
  outputChannel.appendLine(`MCP server initialized on port ${port}`);
}

/**
 * Get the singleton MCP server instance
 * @returns The MCP server instance or undefined if not initialized
 */
export function getMCPServer(): PlutoMCPHttpServer | undefined {
  return mcpServerInstance;
}

/**
 * Start the MCP server
 * @param autoStart - Whether to start automatically
 * @param outputChannel - Output channel for logging
 * @returns Promise that resolves when server starts
 */
export async function startMCPServer(outputChannel: {
  appendLine: (msg: string) => void;
}): Promise<void> {
  if (!mcpServerInstance) {
    outputChannel.appendLine("MCP server not initialized");
    return;
  }

  if (mcpServerInstance.isRunning()) {
    outputChannel.appendLine("MCP server is already running");
    return;
  }

  try {
    await mcpServerInstance.start();
    outputChannel.appendLine(
      `MCP Server started on http://localhost:${mcpServerInstance.getPort()}`
    );
  } catch (error) {
    outputChannel.appendLine(
      `Failed to start MCP Server: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
}

/**
 * Stop the MCP server
 * @returns Promise that resolves when server stops
 */
export async function stopMCPServer(): Promise<void> {
  if (mcpServerInstance?.isRunning()) {
    await mcpServerInstance.stop();
  }
}

/**
 * Cleanup the MCP server singleton
 */
export function cleanupMCPServer(): void {
  mcpServerInstance = undefined;
}
