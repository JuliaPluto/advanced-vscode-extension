import express from "express";
import type { Express, Request, Response } from "express";
import type { Server as HttpServer } from "http";
import { writeFile } from "fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import type { PlutoManager } from "./plutoManager.ts";
import { isPortAvailable, findAvailablePort } from "./portUtils.ts";
import { z } from "zod";
// @ts-expect-error - esbuild will load this as text
import PlutoGuide from "./PLUTO_GUIDE.md";

// Singleton instance
let mcpServerInstance: PlutoMCPHttpServer | undefined;

/**
 * Default bound on how long a tool call may block on cell execution.
 * Long computations keep running server-side; the call returns guidance
 * to poll instead of hanging the MCP client forever (see issue #38).
 */
const EXECUTION_TIMEOUT_MS = 5 * 60_000;

type TimeoutResult<T> = { timedOut: false; value: T } | { timedOut: true };

async function withExecutionTimeout<T>(
  promise: Promise<T>,
  timeoutMs = EXECUTION_TIMEOUT_MS
): Promise<TimeoutResult<T>> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    return await Promise.race([
      promise.then((value): TimeoutResult<T> => ({ timedOut: false, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
    // The original promise keeps running after a timeout — don't let its
    // eventual rejection become an unhandled rejection
    void promise.catch(() => {});
  }
}

/**
 * HTTP/SSE-based MCP Server for Pluto Notebooks
 * This allows the extension and MCP clients to share the same PlutoManager instance
 */
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
  private port: number;
  private readonly dynamicPort: boolean;

  /**
   * @param dynamicPort - when the configured port is busy, move to the next
   * free one instead of failing (used by the extension so multiple VSCode
   * windows can coexist; the CLI stays strict so `tools`/`call` can find it)
   */
  constructor(plutoManager: PlutoManager, port = 3100, dynamicPort = false) {
    this.plutoManager = plutoManager;
    this.port = port;
    this.dynamicPort = dynamicPort;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
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
      "Start the Pluto server on the configured port (set via --pluto-port or extension settings)",
      {},
      async () => {
        if (this.plutoManager.isRunning()) {
          return {
            content: [
              {
                type: "text",
                text: `Pluto server is already running at ${this.plutoManager.getServerUrl()}`,
              },
            ],
          };
        }

        await this.plutoManager.start();
        return {
          content: [
            {
              type: "text",
              text: `Pluto server started at ${this.plutoManager.getServerUrl()}`,
            },
          ],
        };
      }
    );

    // Connect to Pluto Server
    server.tool(
      "connect_to_pluto_server",
      "Connect to an already-running Pluto server at the configured URL (set via --pluto-url or extension settings)",
      {},
      async () => {
        if (this.plutoManager.isConnected()) {
          return {
            content: [
              {
                type: "text",
                text: `Already connected to a Pluto server at ${this.plutoManager.getServerUrl()}`,
              },
            ],
          };
        }

        await this.plutoManager.connect();
        return {
          content: [
            {
              type: "text",
              text: `Connected to Pluto server at ${this.plutoManager.getServerUrl()}`,
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
        // Use isConnected() instead of isRunning() — we may be connected
        // to an externally-managed server (no owned process), and stop
        // should still disconnect and clean up.
        if (
          !this.plutoManager.isConnected() &&
          !this.plutoManager.isRunning()
        ) {
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

        const stillRunning = this.plutoManager.isRunning();
        return {
          content: [
            {
              type: "text",
              text: stillRunning
                ? "Warning: stop() returned but the server process may still be running. It should be force-killed shortly."
                : "Pluto server stopped",
            },
          ],
        };
      }
    );

    // Open Notebook
    server.tool(
      "open_notebook",
      "Open a Pluto notebook file and create a worker session. The .jl file must already exist on disk — Pluto will not create a new file from a nonexistent path. Create the file first if needed.",
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

        const isLocal = this.plutoManager.isLocalServer();
        const syncNote = isLocal
          ? "Pluto is tracking this file path and will save changes to it."
          : "Warning: Pluto server is remote — the file on disk is NOT synced with the server. Use save_notebook to write changes back to the local file.";

        return {
          content: [
            {
              type: "text",
              text: `Notebook opened: ${path}\nNotebook ID: ${worker.notebook_id}\n${syncNote}`,
            },
          ],
        };
      }
    );

    // Move Notebook
    server.tool(
      "move_notebook",
      "Move a notebook to a new file path. Pluto will save to the new path, delete the old file, and move any associated .assets directory. Only works when the server is on localhost.",
      {
        path: z.string().describe("Current path of the open notebook"),
        new_path: z
          .string()
          .describe("Absolute path for the new notebook location"),
      },
      async ({ path, new_path }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        if (!this.plutoManager.isLocalServer()) {
          throw new Error(
            "move_notebook only works when the Pluto server is on localhost (shared filesystem). Use save_notebook to write a copy instead."
          );
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        await this.plutoManager.moveNotebook(worker, new_path);

        return {
          content: [
            {
              type: "text",
              text: `Notebook moved from ${path} to ${new_path}. Pluto is now tracking the new path.`,
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

        const outcome = await withExecutionTimeout(
          this.plutoManager.executeCell(worker, cell_id, cellData.input.code)
        );

        if (outcome.timedOut) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    cell_id: cell_id,
                    timed_out: true,
                    message: `Cell is still running after ${EXECUTION_TIMEOUT_MS / 1000}s. It continues to execute — use wait_for_notebook_idle or poll read_cell to get the result.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = outcome.value;
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
      "Create and execute a new cell in a notebook. WARNING: This always executes the code. If the code is slow (e.g. package installs), the call may time out but the cell IS still created in Pluto. Use list_cells to check before retrying. For slow operations, prefer edit_cell with run=false then execute_cell separately.",
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

        const outcome = await withExecutionTimeout(
          this.plutoManager.runSnippet(worker, index, code)
        );

        if (outcome.timedOut) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    timed_out: true,
                    message: `Execution is still running after ${EXECUTION_TIMEOUT_MS / 1000}s. The cell WAS created (at index ${index}) and continues to run — use list_cells to find its id, then wait_for_notebook_idle or read_cell to get the result. Do NOT retry create_cell.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = outcome.value;
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
      "Update the code of an existing cell. Note: editing the .pluto.jl file on disk has NO effect on the running notebook — all mutations must go through the MCP API. Use save_notebook to persist changes to disk.",
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
        const notebooks = isConnected
          ? this.plutoManager.getOpenNotebooks()
          : [];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  server_running: isConnected,
                  server_url: this.plutoManager.getServerUrl(),
                  open_notebooks: notebooks.length,
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

        const outcome = await withExecutionTimeout(
          this.plutoManager.executeCodeEphemeral(worker, code)
        );

        if (outcome.timedOut) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    timed_out: true,
                    message: `Code is still running after ${EXECUTION_TIMEOUT_MS / 1000}s. It keeps executing in a temporary cell that is deleted automatically when it finishes — use wait_for_notebook_idle to wait for it. For long computations prefer create_cell so the result stays inspectable.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const result = outcome.value;
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

    // Save Notebook
    server.tool(
      "save_notebook",
      "Save the running notebook to disk as a .pluto.jl file. Notebooks are NOT auto-saved — you must call this explicitly to persist changes made via create_cell, edit_cell, or delete_cell.",
      {
        path: z.string().describe("Path of the open notebook"),
        output_path: z
          .string()
          .describe(
            "Optional alternative file path to save to (defaults to the notebook's original path)"
          )
          .optional(),
      },
      async ({ path, output_path }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const content = this.plutoManager.getNotebookContent(worker);
        const savePath = output_path ?? path;
        await writeFile(savePath, content, "utf-8");

        return {
          content: [
            {
              type: "text",
              text: `Notebook saved to ${savePath} (${content.length} bytes)`,
            },
          ],
        };
      }
    );

    // Export Notebook HTML
    server.tool(
      "export_notebook_html",
      "Export the notebook's current state as a self-contained static HTML file (like Pluto's 'Export to HTML' button) and write it to disk.",
      {
        path: z.string().describe("Path of the open notebook"),
        output_path: z
          .string()
          .describe(
            "File path for the HTML export (defaults to the notebook path with a .html extension)"
          )
          .optional(),
      },
      async ({ path, output_path }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const exportUrl = `${this.plutoManager.getServerUrl()}/notebookexport?id=${worker.notebook_id}`;
        const response = await fetch(exportUrl, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          throw new Error(
            `Export failed: ${response.status} ${response.statusText}`
          );
        }
        const html = await response.text();

        const savePath =
          output_path ?? path.replace(/(\.pluto)?\.jl$/, "") + ".html";
        await writeFile(savePath, html, "utf-8");

        return {
          content: [
            {
              type: "text",
              text: `Notebook exported to ${savePath} (${html.length} bytes)`,
            },
          ],
        };
      }
    );

    // Delete Cell
    server.tool(
      "delete_cell",
      "Permanently remove a cell from the notebook by its ID. Use list_cells to find cell IDs.",
      {
        path: z.string().describe("Path to the notebook"),
        cell_id: z.string().describe("UUID of the cell to delete"),
      },
      async ({ path, cell_id }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        await this.plutoManager.deleteCell(worker, cell_id);

        return {
          content: [
            {
              type: "text",
              text: `Cell ${cell_id} deleted`,
            },
          ],
        };
      }
    );

    // Move Cells
    server.tool(
      "move_cells",
      "Move one or more cells to a new position in the notebook. The order of cell_ids is preserved in the result. Use list_cells to find cell IDs and their current positions.",
      {
        path: z.string().describe("Path to the notebook"),
        cell_ids: z
          .array(z.string())
          .describe("Cell UUIDs to move, in desired order"),
        index: z
          .number()
          .describe(
            "Target position in the current cell order (before removing the moved cells). E.g. 0 = beginning, 1 = after first cell."
          ),
      },
      async ({ path, cell_ids, index }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        await this.plutoManager.moveCells(worker, cell_ids, index);

        return {
          content: [
            {
              type: "text",
              text: `Moved ${cell_ids.length} cell(s) to position ${index}`,
            },
          ],
        };
      }
    );

    // Fold/Unfold Cell
    server.tool(
      "fold_cell",
      "Show or hide a cell's code in the Pluto notebook. Folded cells hide their source code but still show output. Use list_cells to find cell IDs.",
      {
        path: z.string().describe("Path to the notebook"),
        cell_id: z.string().describe("UUID of the cell to fold/unfold"),
        folded: z
          .boolean()
          .describe(
            "true to hide (fold) the cell code, false to show (unfold) it"
          ),
      },
      async ({ path, cell_id, folded }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        await this.plutoManager.foldCell(worker, cell_id, folded);

        return {
          content: [
            {
              type: "text",
              text: `Cell ${cell_id} ${folded ? "folded (code hidden)" : "unfolded (code visible)"}`,
            },
          ],
        };
      }
    );

    // List Cells
    server.tool(
      "list_cells",
      "List all cells in a notebook with their IDs, code preview, and execution status. Use this to find cell IDs for read_cell, edit_cell, execute_cell, delete_cell, move_cells, or fold_cell.",
      {
        path: z.string().describe("Path to the notebook"),
      },
      async ({ path }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const snippets = worker.getSnippets();

        const cells = snippets.map((snippet, index) => ({
          cell_id: snippet.cell_id,
          index,
          code_preview: snippet.input.code.split("\n")[0].slice(0, 80),
          code_folded: snippet.input.code_folded,
          errored: snippet.result.errored,
          running: snippet.result.running,
          queued: snippet.result.queued,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: cells.length, cells }, null, 2),
            },
          ],
        };
      }
    );

    // Wait for notebook idle
    server.tool(
      "wait_for_notebook_idle",
      "Block until the notebook has no running or queued cells (or the timeout passes). Use this once after a create_cell/execute_cell/execute_code timeout or after edit_cell kicks off a reactive cascade — instead of polling list_cells/read_cell in a loop.",
      {
        path: z.string().describe("Path to the notebook"),
        timeout_seconds: z
          .number()
          .describe("Maximum seconds to wait (default 120, max 600)")
          .optional()
          .default(120),
      },
      async ({ path, timeout_seconds }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const waitedFrom = Date.now();
        const deadline =
          waitedFrom + Math.min(Math.max(timeout_seconds, 1), 600) * 1000;
        while (!worker.isIdle() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const busyCells = worker
          .getSnippets()
          .filter((s) => s.result.running || s.result.queued)
          .map((s) => s.cell_id);
        const idle = busyCells.length === 0;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  idle,
                  waited_seconds: Math.round((Date.now() - waitedFrom) / 1000),
                  still_busy_cells: busyCells,
                  message: idle
                    ? "Notebook is idle — results are ready to read."
                    : "Timed out with cells still running — call wait_for_notebook_idle again or read partial state with list_cells.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Get Notebook URL
    server.tool(
      "get_notebook_url",
      "Get the browser URL to open the notebook in Pluto's web interface",
      {
        path: z.string().describe("Path to the notebook"),
      },
      async ({ path }) => {
        if (!this.plutoManager.isConnected()) {
          throw new Error("Pluto server is not running");
        }

        const worker = await this.plutoManager.getWorker(path);

        if (!worker) {
          throw new Error(`Notebook ${path} is not open`);
        }

        const url = `${this.plutoManager.getServerUrl()}/edit?id=${worker.notebook_id}`;

        return {
          content: [
            {
              type: "text",
              text: url,
            },
          ],
        };
      }
    );
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
        plutoServerRunning: this.plutoManager.isConnected(),
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
          resolve();
        }
      });
    });
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
      this.httpServer.close(() => {
        console.log("[MCP HTTP] HTTP server closed");
        resolve();
      });
      // Idle keep-alive connections would otherwise hold close() open
      this.httpServer.closeIdleConnections();
    });
    this.httpServer = undefined;
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

  // Dynamic port: a second VSCode window must not fail on a busy port
  mcpServerInstance = new PlutoMCPHttpServer(plutoManager, port, true);
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
