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
        if (plutoManager.getState().status === "stopped") {
          // The start was cancelled
          return;
        }
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

export async function startServer(plutoManager: PlutoManager): Promise<void> {
  await startServerWithProgress(plutoManager, "Pluto server started");
}

export async function stopServer(plutoManager: PlutoManager): Promise<void> {
  try {
    await plutoManager.stop();
    vscode.window.showInformationMessage("Pluto server stopped");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to stop Pluto server: ${errorMessage}`
    );
  }
}

export async function restartServer(plutoManager: PlutoManager): Promise<void> {
  try {
    await plutoManager.restart();
    vscode.window.showInformationMessage("Pluto server restarted");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to restart Pluto server: ${errorMessage}`
    );
  }
}

/**
 * Open a URL in VS Code's Simple Browser beside the editor, or in the
 * system browser when configured so or when the built-in browser is
 * unavailable (e.g. disabled or not shipped by a VS Code fork).
 */
export async function openUrl(url: string): Promise<void> {
  const browser = vscode.workspace
    .getConfiguration("pluto-notebook")
    .get<string>("notebookBrowser", "embedded");
  if (browser === "embedded") {
    try {
      await vscode.commands.executeCommand("simpleBrowser.show", url, {
        viewColumn: vscode.ViewColumn.Beside,
      });
      return;
    } catch {
      // Fall through to the system browser
    }
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

export async function openInBrowser(
  plutoManager: PlutoManager,
  notebookPath?: string
): Promise<void> {
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

    const url = `${plutoManager.getServerUrl()}/edit?id=${worker.notebook_id}`;
    await openUrl(url);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to open notebook in browser: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * A server that is starting is cancelled; it is never started a second
 * time.
 */
export async function toggleServer(plutoManager: PlutoManager): Promise<void> {
  switch (plutoManager.getState().status) {
    case "starting":
      if (plutoManager.cancelStart()) {
        vscode.window.showInformationMessage("Pluto server start cancelled");
      }
      break;
    case "ready":
      await stopServer(plutoManager);
      break;
    case "stopping":
      break;
    case "stopped":
    case "failed":
      await startServer(plutoManager);
      break;
  }
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
