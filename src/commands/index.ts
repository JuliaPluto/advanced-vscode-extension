import * as vscode from "vscode";
import type { PlutoManager } from "../plutoManager.ts";
import { createPlutoTerminal } from "../plutoTerminal.ts";
import type {
  NotebooksTreeDataProvider,
  PlutoNotebookTreeItem,
} from "../treeView/notebooksTreeDataProvider.ts";
import { createProjectMcpConfig, showMcpHttpUrl } from "./mcpConfigCommands.ts";
import {
  restartMcpServer,
  startMcpServer,
  stopMcpServer,
} from "./mcpServerCommands.ts";
import { createNewNotebook } from "./notebookCommands.ts";
import {
  focusCellFromTree,
  openNotebookFromTree,
  reconnectNotebook,
} from "./notebooksTreeCommands.ts";
import {
  openInBrowser,
  restartServer,
  startServer,
  stopServer,
  toggleServer,
} from "./plutoServerCommands.ts";
import { toggleView } from "./viewToggleCommands.ts";

export { initializePlutoServer } from "./plutoServerCommands.ts";

type CommandHandler = (...args: never[]) => unknown;

export interface CommandDeps {
  plutoManager: PlutoManager;
  terminalOutputChannel: vscode.OutputChannel;
  notebooksTree: NotebooksTreeDataProvider;
}

/** Every `pluto-notebook.*` command the extension registers. */
export function commandTable(
  context: vscode.ExtensionContext,
  { plutoManager, terminalOutputChannel, notebooksTree }: CommandDeps
): Record<string, CommandHandler> {
  return {
    "pluto-notebook.startServer": () => startServer(plutoManager),
    "pluto-notebook.stopServer": () => stopServer(plutoManager),
    "pluto-notebook.restartServer": () => restartServer(plutoManager),
    "pluto-notebook.toggleServer": () => toggleServer(plutoManager),
    "pluto-notebook.openInBrowser": (notebookPath?: string) =>
      openInBrowser(plutoManager, notebookPath),

    "pluto-notebook.startMCPServer": startMcpServer,
    "pluto-notebook.stopMCPServer": stopMcpServer,
    "pluto-notebook.restartMCPServer": restartMcpServer,
    "pluto-notebook.createProjectMCPConfig": createProjectMcpConfig,
    "pluto-notebook.getMCPHttpUrl": showMcpHttpUrl,

    "pluto-notebook.createTerminal": () =>
      createPlutoTerminal(plutoManager, terminalOutputChannel, context),

    "pluto-notebook.refreshNotebooks": () => notebooksTree.refresh(),
    "pluto-notebook.openNotebookFromTree": openNotebookFromTree,
    "pluto-notebook.focusCellFromTree": focusCellFromTree,
    "pluto-notebook.reconnectNotebook": (notebook: PlutoNotebookTreeItem) =>
      reconnectNotebook(plutoManager, notebook),

    "pluto-notebook.toggleView": toggleView,
    "pluto-notebook.createNewNotebook": createNewNotebook,
  };
}

export function registerAllCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  for (const [id, handler] of Object.entries(commandTable(context, deps))) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        id,
        handler as (...args: unknown[]) => unknown
      )
    );
  }
}
