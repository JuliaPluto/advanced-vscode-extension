import * as vscode from "vscode";
import type { PlutoManager } from "../plutoManager.ts";

/**
 * Start Pluto server with progress notification
 */
async function startServerWithProgress(
  plutoManager: PlutoManager,
  message = "Pluto server is ready"
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Starting Pluto server...",
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: "Launching Julia process..." });
        await plutoManager.start();
        progress.report({ message: "Server started successfully!" });
        vscode.window.showInformationMessage(message);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to start Pluto server: ${errorMessage}`
        );
        throw error;
      }
    }
  );
}

/**
 * Command: Start Pluto server
 */
export function registerStartServerCommand(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pluto-notebook.startServer", async () => {
      await startServerWithProgress(plutoManager, "Pluto server started");
    })
  );
}

/**
 * Command: Stop Pluto server
 */
export function registerStopServerCommand(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pluto-notebook.stopServer", async () => {
      try {
        await plutoManager.stop();
        vscode.window.showInformationMessage("Pluto server stopped");
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to stop Pluto server: ${errorMessage}`
        );
      }
    })
  );
}

/**
 * Command: Restart Pluto server
 */
export function registerRestartServerCommand(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pluto-notebook.restartServer",
      async () => {
        try {
          await plutoManager.restart();
          vscode.window.showInformationMessage("Pluto server restarted");
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to restart Pluto server: ${errorMessage}`
          );
        }
      }
    )
  );
}

/**
 * Command: Open notebook in browser
 */
export function registerOpenInBrowserCommand(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pluto-notebook.openInBrowser",
      async (notebookPath?: string) => {
        // Prefer the active notebook editor — notebooks don't have a
        // text editor, so activeTextEditor alone misses the main case
        notebookPath ??=
          vscode.window.activeNotebookEditor?.notebook.uri.fsPath ??
          vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!notebookPath) {
          vscode.window.showErrorMessage("No active notebook file");
          return;
        }

        // Check if server is running
        if (!plutoManager.isConnected()) {
          vscode.window.showErrorMessage(
            "Pluto server is not running. Start the server first."
          );
          return;
        }

        try {
          // Get (or create) the worker for this notebook
          const worker = await plutoManager.getWorker(notebookPath);
          if (!worker) {
            vscode.window.showErrorMessage(
              `Could not open ${notebookPath} on the Pluto server.`
            );
            return;
          }

          const url = `${plutoManager.getServerUrl()}/edit?id=${worker.notebook_id}`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to open notebook in browser: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    )
  );
}

/**
 * Command: Toggle Pluto server (start/stop)
 */
export function registerToggleServerCommand(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pluto-notebook.toggleServer", async () => {
      if (plutoManager.isRunning()) {
        // Server is running, stop it
        try {
          await plutoManager.stop();
          vscode.window.showInformationMessage("Pluto server stopped");
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to stop Pluto server: ${errorMessage}`
          );
        }
      } else {
        // Server is stopped, start it
        await startServerWithProgress(plutoManager, "Pluto server started");
      }
    })
  );
}

/**
 * Initialize Pluto server on activation (exported for use in extension.ts)
 */
export async function initializePlutoServer(
  plutoManager: PlutoManager,
  serverOutputChannel: vscode.OutputChannel
): Promise<void> {
  try {
    await startServerWithProgress(plutoManager);
  } catch {
    // Continue activation even if server fails to start
    // Users can manually start the server later
    serverOutputChannel.appendLine(
      "Extension activated but server failed to start. Use 'Start Server' command to retry."
    );
  }
}
