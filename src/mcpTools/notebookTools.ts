import { writeFile } from "fs/promises";
import { z } from "zod";
import { pathArg } from "./args.ts";
import {
  EXECUTION_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  execution,
  notebookTool,
  reply,
  type PlutoTool,
  type PlutoToolsManager,
} from "./tool.ts";

const WAIT_MAX_SECONDS = 600;

function waitSeconds(timeoutSeconds: number): number {
  return Math.min(Math.max(timeoutSeconds, 1), WAIT_MAX_SECONDS);
}

export function notebookTools(manager: PlutoToolsManager): PlutoTool[] {
  return [
    notebookTool(manager, {
      name: "open_notebook",
      description:
        "Open a Pluto notebook file and create a worker session. The .jl file must already exist on disk — Pluto will not create a new file from a nonexistent path. Create the file first if needed.",
      args: {},
      bound: execution(
        (args) =>
          `Opening ${args.path} is still running after ${EXECUTION_TIMEOUT_MS / 1000}s — use list_notebooks to see when it is open, then call open_notebook again.`
      ),
      run: async ({ path }, worker) => {
        const syncNote = !manager.isLocalServer()
          ? "Warning: Pluto server is remote — the file on disk is NOT synced with the server. Use save_notebook to write changes back to the local file."
          : manager.serverWritesNotebookFiles()
            ? "Pluto is tracking this file path and will save changes to it."
            : "The server does not write this file: changes reach disk when the notebook is saved in the editor, or through save_notebook.";
        return `Notebook opened: ${path}\nNotebook ID: ${worker.notebook_id}\n${syncNote}`;
      },
    }),

    notebookTool(manager, {
      name: "move_notebook",
      description:
        "Move a notebook to a new file path: the file is written at the new path, the old file is deleted, and any associated .assets directory moves with it. Only works when the server is on localhost.",
      args: {
        new_path: pathArg("Absolute path for the new notebook location"),
      },
      bound: execution(
        (args) =>
          `Moving ${args.path} to ${args.new_path} has not finished after ${EXECUTION_TIMEOUT_MS / 1000}s — check list_notebooks before retrying.`
      ),
      precondition: () => {
        if (!manager.isLocalServer()) {
          throw new Error(
            "move_notebook only works when the Pluto server is on localhost (shared filesystem). Use save_notebook to write a copy instead."
          );
        }
      },
      run: async ({ path, new_path }, worker) => {
        await manager.moveNotebook(worker, new_path);
        return `Notebook moved from ${path} to ${new_path}. Pluto is now tracking the new path.`;
      },
    }),

    notebookTool(manager, {
      name: "save_notebook",
      description:
        "Write the running notebook to disk as a .pluto.jl file, exactly as Pluto would save it (embedded package environment included). Needed whenever the server does not write the file itself: a remote server never does, and the VS Code extension's server leaves writing to the editor. open_notebook reports which applies.",
      args: {
        output_path: pathArg(
          "Optional alternative file path to save to (defaults to the notebook's original path)"
        ).optional(),
      },
      bound: execution(
        `save_notebook has not finished after ${EXECUTION_TIMEOUT_MS / 1000}s; the connection to the Pluto server may be stalled — check get_notebook_status, then call save_notebook again.`
      ),
      run: async ({ path, output_path }, worker) => {
        const content = await manager.getNotebookContent(worker);
        const savePath = output_path ?? path;
        await writeFile(savePath, content, "utf-8");
        return `Notebook saved to ${savePath} (${content.length} bytes)`;
      },
    }),

    notebookTool(manager, {
      name: "export_notebook_html",
      description:
        "Export the notebook's current state as a self-contained static HTML file (like Pluto's 'Export to HTML' button) and write it to disk.",
      args: {
        output_path: pathArg(
          "File path for the HTML export (defaults to the notebook path with a .html extension)"
        ).optional(),
      },
      bound: execution(
        `export_notebook_html has not finished after ${EXECUTION_TIMEOUT_MS / 1000}s; the connection to the Pluto server may be stalled — check get_notebook_status, then call export_notebook_html again.`
      ),
      run: async ({ path, output_path }, worker) => {
        const exportUrl = `${manager.getServerUrl()}/notebookexport?id=${worker.notebook_id}`;
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
        return `Notebook exported to ${savePath} (${html.length} bytes)`;
      },
    }),

    notebookTool(manager, {
      name: "wait_for_notebook_idle",
      description:
        "Block until the notebook has no running or queued cells (or the timeout passes). Use this once after a create_cell/execute_cell/execute_code timeout or after edit_cell kicks off a reactive cascade — instead of polling list_cells/read_cell in a loop.",
      args: {
        timeout_seconds: z
          .number()
          .describe("Maximum seconds to wait (default 120, max 600)")
          .optional()
          .default(120),
      },
      bound: {
        ...reply(),
        ms: (args) =>
          waitSeconds(args.timeout_seconds) * 1000 + REPLY_TIMEOUT_MS,
      },
      run: async ({ timeout_seconds }, worker) => {
        const waitedFrom = Date.now();
        const deadline = waitedFrom + waitSeconds(timeout_seconds) * 1000;
        while (!worker.isIdle() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const busyCells = worker
          .getSnippets()
          .filter((s) => s.result.running || s.result.queued)
          .map((s) => s.cell_id);
        const idle = busyCells.length === 0;
        return {
          idle,
          waited_seconds: Math.round((Date.now() - waitedFrom) / 1000),
          still_busy_cells: busyCells,
          message: idle
            ? "Notebook is idle — results are ready to read."
            : "Timed out with cells still running — call wait_for_notebook_idle again or read partial state with list_cells.",
        };
      },
    }),

    notebookTool(manager, {
      name: "get_notebook_url",
      description:
        "Get the browser URL to open the notebook in Pluto's web interface",
      args: {},
      run: async (_args, worker) =>
        `${manager.getServerUrl()}/edit?id=${worker.notebook_id}`,
    }),
  ];
}
