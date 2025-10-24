import "@plutojl/rainbow/node-polyfill";

import * as vscode from "vscode";
import { PlutoNotebookSerializer } from "./serializer.ts";
import { PlutoNotebookController } from "./controller.ts";
import {
  registerAllCommands,
  initializePlutoServer,
} from "./commands/index.ts";
import { getSharedPlutoManager } from "./plutoManagerInstance.ts";
import {
  initializeMCPServer,
  startMCPServer,
  stopMCPServer,
  cleanupMCPServer,
} from "./mcp-server-http.ts";
import { PlutoTerminalProvider } from "./plutoTerminal.ts";
import { PlutoStatusBar } from "./statusBar.ts";
import { registerNotebooksTreeView } from "./treeView/notebooksTreeView.ts";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  // Create controller output channel
  const controllerOutputChannel =
    vscode.window.createOutputChannel("Pluto Controller");
  context.subscriptions.push(controllerOutputChannel);

  // Get port from configuration
  const config = vscode.workspace.getConfiguration("pluto-notebook");
  const plutoPort = config.get<number>("port", 1234);
  const serverUrl = config.get<string>("serverUrl", "");
  const mcpPort = config.get<number>("mcpPort", 3100);
  const autoStartMcp = config.get<boolean>("autoStartMcpServer", true);

  // Initialize shared Pluto Manager
  const plutoManager = getSharedPlutoManager(
    plutoPort,
    {
      showWarningMessage: vscode.window.showWarningMessage,
      showErrorMessage: vscode.window.showErrorMessage,
      showInfoMessage: vscode.window.showInformationMessage,
    },
    serverUrl || undefined
  );
  context.subscriptions.push(plutoManager);

  // Initialize HTTP MCP Server using the shared PlutoManager (singleton)
  initializeMCPServer(plutoManager, mcpPort, controllerOutputChannel);

  // Auto-start MCP server if configured
  if (autoStartMcp) {
    await startMCPServer(controllerOutputChannel);
  }

  // Ensure MCP server is stopped and cleaned up when extension deactivates
  context.subscriptions.push({
    dispose: async () => {
      await stopMCPServer();
      cleanupMCPServer();
    },
  });

  // Start Pluto server on activation
  await initializePlutoServer(plutoManager, controllerOutputChannel);

  // Register the notebook serializer
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      "pluto-notebook",
      new PlutoNotebookSerializer()
    )
  );

  // Register the notebook controller
  const controller = new PlutoNotebookController(
    plutoManager,
    controllerOutputChannel
  );
  context.subscriptions.push(controller);

  // Register already-open notebooks
  for (const notebook of vscode.workspace.notebookDocuments) {
    if (notebook.notebookType === "pluto-notebook") {
      await controller.registerNotebookDocument(notebook);
    }
  }

  // Initialize workers when notebooks are opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenNotebookDocument(async (notebook) => {
      await controller.registerNotebookDocument(notebook);
    })
  );

  // Handle notebook cell changes (add/delete cells)
  context.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument(async (event) => {
      await controller.handleVsCodeNotebookChange(event);
    })
  );

  // Register all commands
  registerAllCommands(context, plutoManager);

  // Create and register status bar
  const statusBar = new PlutoStatusBar(plutoManager);
  context.subscriptions.push(statusBar);

  // Register notebooks tree view
  registerNotebooksTreeView(context, plutoManager);

  // Register terminal profile provider
  const terminalOutputChannel =
    vscode.window.createOutputChannel("Pluto Terminal");
  context.subscriptions.push(terminalOutputChannel);

  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider("pluto-notebook.terminal", {
      provideTerminalProfile() // _token: vscode.CancellationToken
      : vscode.ProviderResult<vscode.TerminalProfile> {
        const pty = new PlutoTerminalProvider(
          plutoManager,
          terminalOutputChannel,
          context
        );
        return new vscode.TerminalProfile({
          name: "Pluto Terminal",
          pty,
          iconPath: new vscode.ThemeIcon("symbol-namespace"),
        });
      },
    })
  );
}

export function deactivate() {}
