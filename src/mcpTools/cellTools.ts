import { z } from "zod";
import { presentOutput } from "../notebookOutput.ts";
import { cellId, cellIds } from "./args.ts";
import {
  EXECUTION_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  execution,
  notebookTool,
  reply,
  unacknowledged,
  withTimeout,
  type PlutoTool,
  type PlutoToolsManager,
} from "./tool.ts";

const seconds = EXECUTION_TIMEOUT_MS / 1000;

export function cellTools(manager: PlutoToolsManager): PlutoTool[] {
  return [
    notebookTool(manager, {
      name: "execute_cell",
      description:
        "Execute an existing code cell in an open notebook by its ID",
      args: { cell_id: cellId },
      bound: execution(
        `Cell is still running after ${seconds}s. It continues to execute — use wait_for_notebook_idle or poll read_cell to get the result.`
      ),
      run: async ({ path, cell_id }, worker) => {
        if (!worker.getSnippet(cell_id)) {
          throw new Error(`Cell ${cell_id} not found`);
        }
        const result = await manager.runCell(path, cell_id);
        return {
          cell_id,
          output: presentOutput(result?.output),
          runtime: result?.runtime,
          errored: result?.errored,
        };
      },
    }),

    notebookTool(manager, {
      name: "create_cell",
      description:
        "Create and execute a new cell in a notebook. WARNING: This always executes the code. If the code is slow (e.g. package installs), the call may time out but the cell IS still created in Pluto. Use list_cells to check before retrying. For slow operations, prefer edit_cell with run=false then execute_cell separately.",
      args: {
        code: z.string().describe("Julia code for the new cell"),
        index: z.number().describe("Cell index position").optional().default(0),
      },
      bound: execution(
        (args) =>
          `Execution is still running after ${seconds}s. The cell WAS created (at index ${args.index}) and continues to run — use list_cells to find its id, then wait_for_notebook_idle or read_cell to get the result. Do NOT retry create_cell.`
      ),
      run: async ({ path, code, index }) => {
        const result = await manager.runSnippet(path, index, code);
        return {
          cell_id: result.cell_id,
          output: presentOutput(result.output),
          runtime: result.runtime,
          errored: result.errored,
          message: "Cell created and executed successfully",
        };
      },
    }),

    notebookTool(manager, {
      name: "edit_cell",
      description:
        "Update the code of an existing cell and, by default, run it; the result returned is the cell's output after that run, or timed_out if the run takes longer than five minutes (it keeps running — use wait_for_notebook_idle; do not retry edit_cell). Editing the .pluto.jl file on disk has NO effect on the running notebook — all mutations must go through these tools. Use save_notebook to persist changes to disk.",
      args: {
        cell_id: cellId,
        code: z.string().describe("New Julia code for the cell"),
        run: z
          .boolean()
          .describe("Whether to run the cell after updating")
          .optional()
          .default(true),
      },
      bound: execution((args) =>
        args.run
          ? `edit_cell has not finished after ${seconds}s. The new code was sent and the run requested; the cell keeps executing — use wait_for_notebook_idle, then read_cell to check its code and result. Do NOT retry edit_cell; poll instead.`
          : `Pluto has not acknowledged the new code after ${seconds}s; the connection to the notebook may be stalled — use read_cell to check whether the code arrived before retrying.`
      ),
      run: async ({ path, cell_id, code, run }) => {
        let result = null;
        if (run) {
          result = await manager.executeCell(path, cell_id, code);
        } else {
          await manager.setCellCode(path, cell_id, code);
        }
        return {
          cell_id,
          output: presentOutput(result?.output),
          runtime: result?.runtime,
          errored: result?.errored,
          message: run
            ? "Cell updated and executed"
            : "Cell code updated in Pluto (not executed; run it with execute_cell)",
        };
      },
    }),

    notebookTool(manager, {
      name: "read_cell",
      description: "Read the code and output of a cell by its ID",
      args: { cell_id: cellId },
      run: async ({ cell_id }, worker) => {
        const cellData = worker.getSnippet(cell_id);
        if (!cellData) {
          return { error: `Cell ${cell_id} not found` };
        }
        return {
          cell_id,
          code: cellData.input.code,
          output: presentOutput(cellData.result.output),
          runtime: cellData.result.runtime,
          errored: cellData.result.errored,
          running: cellData.result.running,
          queued: cellData.result.queued,
        };
      },
    }),

    notebookTool(manager, {
      name: "execute_code",
      description:
        "Execute Julia code in a notebook without creating a persistent cell (ephemeral execution)",
      args: {
        code: z.string().describe("Julia code to execute"),
      },
      bound: execution(
        `Code is still running after ${seconds}s. It keeps executing in a temporary cell that is deleted automatically when it finishes — use wait_for_notebook_idle to wait for it. For long computations prefer create_cell so the result stays inspectable.`
      ),
      run: async ({ path, code }) => {
        const result = await manager.executeCodeEphemeral(path, code);
        return {
          output: presentOutput(result.output),
          runtime: result.runtime,
          errored: result.errored,
          message: "Code executed successfully (no cell created)",
        };
      },
    }),

    notebookTool(manager, {
      name: "get_docs",
      description:
        "Get markdown documentation for a Julia symbol (function, type, variable, etc.) in the context of an open notebook",
      args: {
        symbol: z
          .string()
          .describe(
            "Julia symbol to get documentation for (e.g., 'sum', 'plot', 'DataFrame')"
          ),
      },
      bound: reply((args) => `the documentation request for '${args.symbol}'`),
      run: async ({ symbol }, worker) => {
        try {
          const docs = await worker.getDocs(symbol);
          return docs || `No documentation found for symbol: ${symbol}`;
        } catch (error) {
          return `Error retrieving documentation for '${symbol}': ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      },
    }),

    notebookTool(manager, {
      name: "introspect_notebook",
      description:
        "Get all symbols defined in the notebook with their documentation. Returns a comprehensive list of variables, functions, and types available in the notebook's scope.",
      args: {
        include_docs: z
          .boolean()
          .describe("Whether to include documentation for each symbol")
          .optional()
          .default(true),
      },
      bound: execution(
        `introspect_notebook has not finished after ${seconds}s; the connection to the notebook may be stalled — check get_notebook_status, or call introspect_notebook with include_docs: false.`
      ),
      run: async ({ include_docs }, worker) => {
        try {
          const notebookData = worker.getState();
          const cellOrder = notebookData.cell_order;

          if (!cellOrder || !Array.isArray(cellOrder)) {
            return {
              symbols: [],
              count: 0,
              message: "No cells found in notebook",
            };
          }

          const symbolsSet = new Set<string>();
          for (const id of cellOrder) {
            const cellDependencies = notebookData.cell_dependencies[id];
            if (cellDependencies?.downstream_cells_map) {
              for (const symbol of Object.keys(
                cellDependencies.downstream_cells_map
              )) {
                symbolsSet.add(symbol);
              }
            }
          }
          const symbols = Array.from(symbolsSet).sort();

          let symbolsWithDocs: Array<{ symbol: string; docs?: string }> = [];
          let unanswered = 0;

          if (include_docs) {
            symbolsWithDocs = await Promise.all(
              symbols.map(async (symbol) => {
                try {
                  const outcome = await withTimeout(
                    worker.getDocs(symbol),
                    REPLY_TIMEOUT_MS
                  );
                  if (outcome.timedOut) {
                    unanswered++;
                    return { symbol };
                  }
                  return { symbol, docs: outcome.value || undefined };
                } catch {
                  return { symbol, docs: undefined };
                }
              })
            );
          } else {
            symbolsWithDocs = symbols.map((symbol) => ({ symbol }));
          }

          return {
            count: symbols.length,
            symbols: symbolsWithDocs,
            message:
              `Found ${symbols.length} symbol(s) in notebook` +
              (unanswered
                ? `; Pluto did not answer ${unanswered} documentation request(s) within ${REPLY_TIMEOUT_MS / 1000}s, so those symbols have no docs. The connection to the notebook may be stalled — check get_notebook_status, or reopen the notebook with open_notebook.`
                : ""),
          };
        } catch (error) {
          return `Error introspecting notebook: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      },
    }),

    notebookTool(manager, {
      name: "delete_cell",
      description:
        "Permanently remove a cell from the notebook by its ID. Use list_cells to find cell IDs.",
      args: { cell_id: cellId },
      bound: unacknowledged(),
      run: async ({ path, cell_id }) => {
        await manager.deleteCell(path, cell_id);
        return `Cell ${cell_id} deleted`;
      },
    }),

    notebookTool(manager, {
      name: "move_cells",
      description:
        "Move one or more cells to a new position in the notebook. The order of cell_ids is preserved in the result. Use list_cells to find cell IDs and their current positions.",
      args: {
        cell_ids: cellIds,
        index: z
          .number()
          .describe(
            "Target position in the current cell order (before removing the moved cells). E.g. 0 = beginning, 1 = after first cell."
          ),
      },
      bound: unacknowledged(),
      run: async ({ path, cell_ids, index }) => {
        await manager.moveCells(path, cell_ids, index);
        return `Moved ${cell_ids.length} cell(s) to position ${index}`;
      },
    }),

    notebookTool(manager, {
      name: "fold_cell",
      description:
        "Show or hide a cell's code in the Pluto notebook. Folded cells hide their source code but still show output. Use list_cells to find cell IDs.",
      args: {
        cell_id: cellId,
        folded: z
          .boolean()
          .describe(
            "true to hide (fold) the cell code, false to show (unfold) it"
          ),
      },
      bound: unacknowledged(),
      run: async ({ path, cell_id, folded }) => {
        await manager.foldCell(path, cell_id, folded);
        return `Cell ${cell_id} ${folded ? "folded (code hidden)" : "unfolded (code visible)"}`;
      },
    }),

    notebookTool(manager, {
      name: "list_cells",
      description:
        "List all cells in a notebook with their IDs, code preview, and execution status. Use this to find cell IDs for read_cell, edit_cell, execute_cell, delete_cell, move_cells, or fold_cell.",
      args: {},
      run: async (_args, worker) => {
        const cells = worker.getSnippets().map((snippet, index) => ({
          cell_id: snippet.cell_id,
          index,
          code_preview: snippet.input.code.split("\n")[0].slice(0, 80),
          code_folded: snippet.input.code_folded,
          errored: snippet.result.errored,
          running: snippet.result.running,
          queued: snippet.result.queued,
        }));
        return { count: cells.length, cells };
      },
    }),
  ];
}
