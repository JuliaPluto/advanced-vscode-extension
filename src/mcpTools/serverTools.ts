import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { z } from "zod";
import { newNotebookSource } from "../notebookOutput.ts";
import { otherPlutoServerMessage, sameUrl } from "../plutoServerUrl.ts";
import { notebookPath } from "./args.ts";
import {
  EXECUTION_TIMEOUT_MS,
  STILL_STARTING,
  execution,
  resolveNotebook,
  serverTool,
  tool,
  type PlutoTool,
  type PlutoToolsManager,
} from "./tool.ts";
// @ts-expect-error - esbuild will load this as text
import PlutoGuide from "../PLUTO_GUIDE.md";

export function serverTools(manager: PlutoToolsManager): PlutoTool[] {
  return [
    tool({
      name: "learn_pluto_basics",
      description:
        "Read this first. The guide to working with Pluto notebooks through these tools: the recommended workflow, reactivity rules (one definition per variable), package environments — including notebooks inside a Julia project that load a local package — how paths work inside Pluto, PlutoUI, and how to read outputs and plots.",
      args: {},
      run: async () => PlutoGuide as string,
    }),

    tool({
      name: "start_pluto_server",
      description:
        "Start the Pluto server on the configured port (set via --pluto-port or extension settings)",
      args: {},
      bound: execution(STILL_STARTING),
      run: async () => {
        if (manager.isConnected()) {
          return `Pluto server is already running at ${manager.getServerUrl()}`;
        }
        await manager.start();
        return `Pluto server started at ${manager.getServerUrl()}`;
      },
    }),

    tool({
      name: "connect_to_pluto_server",
      description:
        "Connect to the already-running Pluto server this tool server is configured for (the command-line tool's --pluto-url, or the VS Code extension settings). A `url` is checked against that server; a different one is refused, since the tool server cannot be pointed at another Pluto server.",
      args: {
        url: z
          .string()
          .regex(/^https?:\/\//i, "Must be an http:// or https:// URL")
          .url()
          .optional()
          .describe(
            "Expected URL of the running Pluto server, e.g. http://localhost:1234"
          ),
      },
      bound: execution(STILL_STARTING),
      run: async ({ url }) => {
        if (manager.getState().status === "starting") {
          await manager.start();
        }
        const current = manager.getServerUrl();
        if (url && !sameUrl(url, current)) {
          throw new Error(otherPlutoServerMessage(current, url));
        }
        if (manager.isConnected()) {
          return `Already connected to a Pluto server at ${current}`;
        }
        await manager.connect();
        return `Connected to Pluto server at ${manager.getServerUrl()}`;
      },
    }),

    tool({
      name: "stop_pluto_server",
      description: "Stop the running Pluto server",
      args: {},
      bound: execution(
        `The Pluto server is still stopping after ${EXECUTION_TIMEOUT_MS / 1000}s and keeps stopping — poll get_notebook_status until server_state is stopped.`
      ),
      run: async () => {
        if (manager.getState().status === "stopped") {
          return "No Pluto server is running";
        }
        await manager.stop();
        return "Pluto server stopped";
      },
    }),

    tool({
      name: "get_notebook_status",
      description: "Get the status of the Pluto server and open notebooks",
      args: {},
      run: async () => {
        const state = manager.getState();
        const isConnected = state.status === "ready";
        const notebooks = isConnected ? manager.getOpenNotebooks() : [];
        return {
          server_running: isConnected,
          server_state: state.status,
          ...(state.status === "failed" && {
            failure_reason: state.reason,
          }),
          server_url: manager.getServerUrl(),
          open_notebooks: notebooks.length,
          message: isConnected
            ? "Pluto server is running"
            : "Pluto server is not running",
        };
      },
    }),

    serverTool(manager, {
      name: "list_notebooks",
      description:
        "Get a list of all open notebooks with their paths and notebook IDs",
      args: {},
      run: async () => {
        const notebooks = manager.getOpenNotebooks();
        return { count: notebooks.length, notebooks };
      },
    }),

    serverTool(manager, {
      name: "create_notebook",
      description:
        "Create a new, empty Pluto notebook file at the given path (optionally with a markdown title cell) and open it. Fails if the file already exists — use open_notebook for existing files.",
      args: {
        path: notebookPath,
        title: z
          .string()
          .describe("Title for an initial markdown cell")
          .optional(),
      },
      bound: execution(
        (args) =>
          `Opening ${args.path} is still running after ${EXECUTION_TIMEOUT_MS / 1000}s. The file was created — use list_notebooks to see when it is open. Do NOT retry create_notebook; use open_notebook.`
      ),
      run: async ({ path, title }) => {
        if (existsSync(path)) {
          throw new Error(
            `${path} already exists — use open_notebook to open it`
          );
        }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, newNotebookSource(title), "utf-8");

        const worker = await resolveNotebook(manager, path);
        return `Notebook created and opened: ${path}\nNotebook ID: ${worker.notebook_id}\nAdd cells with create_cell; call save_notebook to persist them.`;
      },
    }),
  ];
}
