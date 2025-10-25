import express from "express";
import type { Express, Request, Response } from "express";
import type { Server as HttpServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { PlutoManager } from "./plutoManager.ts";
import { z } from "zod";
// @ts-expect-error - esbuild will load this as text
import PlutoGuide from "./PLUTO_GUIDE.md";

// Singleton instance
let mcpServerInstance: PlutoMCPHttpServer | undefined;

/**
 * HTTP/SSE-based MCP Server for Pluto Notebooks
 * This allows the extension and MCP clients to share the same PlutoManager instance
 */
export class PlutoMCPHttpServer {
  private readonly app: Express;
  private httpServer?: HttpServer;
  private readonly transports: Map<string, SSEServerTransport> = new Map();
  private readonly plutoManager: PlutoManager;
  private readonly port: number;

  constructor(plutoManager: PlutoManager, port = 3100) {
    this.plutoManager = plutoManager;
    this.port = port;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private createMcpServer(): McpServer {
    const server = new McpServer(
      {
        name: "pluto-notebook-mcp-server",
        version: "0.0.1",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Register all tools
    this.registerTools(server);

    return server;
  }

  private registerTools(server: McpServer): void {
    // Learn Pluto Basics
    server.tool(
      "learn_pluto_basics",
      "Get comprehensive guide on Pluto.jl notebook structure, reactivity, PlutoUI components, and best practices",
      {},
      async () => {
        return {
          content: [
            {
              type: "text",
              text: PlutoGuide,
            },
          ],
        };
      }
    );

    // Start Pluto Server
    server.tool(
      "start_pluto_server",
      "Start the Pluto server on a specified port",
      {
        port: z
          .number()
          .describe("Port number for the Pluto server")
          .optional()
          .default(1234),
      },
      async ({ port }) => {
        if (this.plutoManager.isRunning()) {
          return {
            content: [
              {
                type: "text",
                text: "Pluto server is already running",
              },
            ],
          };
        }

        await this.plutoManager.start();
        return {
          content: [
            {
              type: "text",
              text: `Pluto server started on port ${port}`,
            },
          ],
        };
      }
    );

    // Connect to Pluto Server
    server.tool(
      "connect_to_pluto_server",
      "Connect to an existing Pluto server (assumes server is already running)",
      {
        port: z
          .number()
          .describe("Port number of the running Pluto server")
          .optional()
          .default(1234),
      },
      async ({ port }) => {
        if (this.plutoManager.isConnected()) {
          return {
            content: [
              {
                type: "text",
                text: "Already connected to a Pluto server",
              },
            ],
          };
        }

        await this.plutoManager.connect();
        return {
          content: [
            {
              type: "text",
              text: `Connected to Pluto server at port ${port}`,
            },
          ],
        };
      }
    );

    // Stop Pluto Server
    server.tool(
      "stop_pluto_server",
      "Stop the running Pluto server",
      {},
      async () => {
        if (!this.plutoManager.isRunning()) {
          return {
            content: [
              {
                type: "text",
                text: "No Pluto server is running",
              },
            ],
          };
        }

        await this.plutoManager.stop();
        return {
          content: [
            {
              type: "text",
              text: "Pluto server stopped",
            },
          ],
        };
      }
    );

    // Open Notebook
    server.tool(
      "open_notebook",
      "Open a Pluto notebook file and create a worker session",
      {
        path: z.string().describe("Path to the .jl notebook file"),
      },
      async ({ path }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error(
            "Pluto server is not running. Start it first with start_pluto_server"
          );
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error("Failed to create worker for notebook");
        }

        return {
          content: [
            {
              type: "text",
              text: `Notebook opened: ${path}\nNotebook ID: ${worker.notebook_id}`,
            },
          ],
        };
      }
    );

    // Execute Cell
    server.tool(
      "execute_cell",
      "Execute an existing code cell in an open notebook by its ID",
      {
        path: z.string().describe("Path to the notebook"),
        cell_id: z.string().describe("UUID of the cell to execute"),
      },
      async ({ path, cell_id }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const cellData = worker.getSnippet(cell_id);

        if (!cellData) {
          throw new Error(`Cell ${cell_id} not found`);
        }

        const result = await this.plutoManager.executeCell(
          worker,
          cell_id,
          cellData.input.code
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  cell_id: cell_id,
                  output: result?.output,
                  runtime: result?.runtime,
                  errored: result?.errored,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Create Cell
    server.tool(
      "create_cell",
      "Create and execute a new cell in a notebook",
      {
        path: z.string().describe("Path to the notebook"),
        code: z.string().describe("Julia code for the new cell"),
        index: z.number().describe("Cell index position").optional().default(0),
      },
      async ({ path, code, index }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const result = await worker.waitSnippet(index, code);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  cell_id: result.cell_id,
                  output: result.output,
                  runtime: result.runtime,
                  errored: result.errored,
                  message: "Cell created and executed successfully",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Edit Cell
    server.tool(
      "edit_cell",
      "Update the code of an existing cell",
      {
        path: z.string().describe("Path to the notebook"),
        cell_id: z.string().describe("UUID of the cell to edit"),
        code: z.string().describe("New Julia code for the cell"),
        run: z
          .boolean()
          .describe("Whether to run the cell after updating")
          .optional()
          .default(true),
      },
      async ({ path, cell_id, code, run }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        let result = null;

        if (run) {
          result = await this.plutoManager.executeCell(worker, cell_id, code);
        } else {
          await worker.updateSnippetCode(cell_id, code, false);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  cell_id: cell_id,
                  output: result?.output,
                  runtime: result?.runtime,
                  errored: result?.errored,
                  message: run
                    ? "Cell updated and executed successfully"
                    : "Cell code updated (not executed)",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Read Cell
    server.tool(
      "read_cell",
      "Read the code and output of a cell by its ID",
      {
        path: z.string().describe("Path to the notebook"),
        cell_id: z.string().describe("UUID of the cell to read"),
      },
      async ({ path, cell_id }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const cellData = worker.getSnippet(cell_id);

        if (!cellData) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: `Cell ${cell_id} not found`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  cell_id: cell_id,
                  code: cellData.input.code,
                  output: cellData.result.output,
                  runtime: cellData.result.runtime,
                  errored: cellData.result.errored,
                  running: cellData.result.running,
                  queued: cellData.result.queued,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Get Status
    server.tool(
      "get_notebook_status",
      "Get the status of the Pluto server and open notebooks",
      {},
      async () => {
        const isConnected = this.plutoManager.isConnected();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  server_running: isConnected,
                  message: isConnected
                    ? "Pluto server is running"
                    : "Pluto server is not running",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // List Open Notebooks
    server.tool(
      "list_notebooks",
      "Get a list of all open notebooks with their paths and notebook IDs",
      {},
      async () => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const notebooks = this.plutoManager.getOpenNotebooks();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: notebooks.length,
                  notebooks: notebooks,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Execute Code (Ephemeral - no cell created)
    server.tool(
      "execute_code",
      "Execute Julia code in a notebook without creating a persistent cell (ephemeral execution)",
      {
        path: z.string().describe("Path to the notebook"),
        code: z.string().describe("Julia code to execute"),
      },
      async ({ path, code }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const result = await this.plutoManager.executeCodeEphemeral(
          worker,
          code
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  output: result.output,
                  runtime: result.runtime,
                  errored: result.errored,
                  message: "Code executed successfully (no cell created)",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Get Documentation
    server.tool(
      "get_docs",
      "Get markdown documentation for a Julia symbol (function, type, variable, etc.) in the context of an open notebook",
      {
        path: z.string().describe("Path to the notebook"),
        symbol: z
          .string()
          .describe(
            "Julia symbol to get documentation for (e.g., 'sum', 'plot', 'DataFrame')"
          ),
      },
      async ({ path, symbol }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        try {
          const docs = await worker.getDocs(symbol);

          return {
            content: [
              {
                type: "text",
                text: docs || `No documentation found for symbol: ${symbol}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving documentation for '${symbol}': ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Introspect Notebook
    server.tool(
      "introspect_notebook",
      "Get all symbols defined in the notebook with their documentation. Returns a comprehensive list of variables, functions, and types available in the notebook's scope.",
      {
        path: z.string().describe("Path to the notebook"),
        include_docs: z
          .boolean()
          .describe("Whether to include documentation for each symbol")
          .optional()
          .default(true),
      },
      async ({ path, include_docs }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        try {
          // Get notebook state and cell order
          const notebookData = worker.getState();
          const cellOrder = notebookData.cell_order;

          if (!cellOrder || !Array.isArray(cellOrder)) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      symbols: [],
                      count: 0,
                      message: "No cells found in notebook",
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // Collect all symbols from all cells
          const symbolsSet = new Set<string>();

          for (const cellId of cellOrder) {
            const cellDependencies = notebookData.cell_dependencies[cellId];
            if (cellDependencies?.downstream_cells_map) {
              const symbols = Object.keys(
                cellDependencies.downstream_cells_map
              );
              symbols.forEach((symbol) => symbolsSet.add(symbol));
            }
          }

          const symbols = Array.from(symbolsSet).sort();

          // Get documentation for each symbol if requested
          let symbolsWithDocs: Array<{ symbol: string; docs?: string }> = [];

          if (include_docs) {
            symbolsWithDocs = await Promise.all(
              symbols.map(async (symbol) => {
                try {
                  const docs = await worker.getDocs(symbol);
                  return { symbol, docs: docs || undefined };
                } catch {
                  return { symbol, docs: undefined };
                }
              })
            );
          } else {
            symbolsWithDocs = symbols.map((symbol) => ({ symbol }));
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    count: symbols.length,
                    symbols: symbolsWithDocs,
                    message: `Found ${symbols.length} symbol(s) in notebook`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error introspecting notebook: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );
  }

  private setupRoutes(): void {
    // SSE endpoint for establishing the stream
    this.app.get("/mcp", async (_req: Request, res: Response) => {
      console.log(
        "[MCP HTTP] Received GET request to /mcp (establishing SSE stream)"
      );

      try {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        this.transports.set(sessionId, transport);

        transport.onclose = () => {
          console.log(
            `[MCP HTTP] SSE transport closed for session ${sessionId}`
          );
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
        plutoServerRunning: this.plutoManager.isConnected(),
        activeSessions: this.transports.size,
      });
    });
  }

  private setupErrorHandling(): void {
    process.on("SIGINT", async () => {
      console.log("[MCP HTTP] Shutting down server...");
      await this.stop();
      process.exit(0);
    });
  }

  public async start(): Promise<void> {
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
          resolve();
        }
      });
    });
  }

  public async stop(): Promise<void> {
    console.log("[MCP HTTP] Stopping MCP server...");

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

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => {
        console.log("[MCP HTTP] HTTP server closed");
        resolve();
      });
    });
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
 */
export function initializeMCPServer(
  plutoManager: PlutoManager,
  port: number,
  outputChannel: {
    appendLine: (msg: string) => void;
  }
): void {
  if (mcpServerInstance) {
    outputChannel.appendLine("MCP server already initialized");
    return;
  }

  mcpServerInstance = new PlutoMCPHttpServer(plutoManager, port);
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
