import * as vscode from "vscode";
import type { CellResultData } from "@plutojl/rainbow";
import { terminalOutputHtml } from "./terminalOutputHtml.ts";

/** Injected by esbuild from node_modules/@plutojl/rainbow/package.json. */
declare const __RAINBOW_VERSION__: string;

/**
 * Manages webview panels for displaying terminal output with rich content
 * Reuses the existing Pluto renderer components
 */
export class TerminalOutputWebviewProvider {
  private static readonly panels = new Map<string, vscode.WebviewPanel>();
  private static currentOutputId = 0;

  /**
   * Show terminal output in a webview panel
   */
  public static showOutput(
    context: vscode.ExtensionContext,
    result: CellResultData,
    title = "Terminal Output"
  ): void {
    const outputId = `terminal-output-${this.currentOutputId++}`;
    const columnToShowIn =
      vscode.window.activeTextEditor?.viewColumn ?? undefined;

    // Check if we already have a panel
    let panel = this.panels.get(outputId);

    if (panel) {
      // If we already have a panel, show it
      panel.reveal(columnToShowIn);
    } else {
      // Create new panel
      panel = vscode.window.createWebviewPanel(
        "plutoTerminalOutput",
        title,
        columnToShowIn ?? vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist"),
          ],
        }
      );

      this.panels.set(outputId, panel);

      // Handle panel disposal
      panel.onDidDispose(() => {
        this.panels.delete(outputId);
      });
    }

    // Set the webview content
    panel.webview.html = this.getWebviewContent(panel.webview, context, result);
  }

  /**
   * Show latest output in a persistent webview (reuses same panel)
   */
  public static showLatestOutput(
    context: vscode.ExtensionContext,
    result: CellResultData
  ): void {
    const outputId = "terminal-output-latest";
    const columnToShowIn = vscode.ViewColumn.Beside;

    let panel = this.panels.get(outputId);

    if (!panel) {
      // Create new panel
      panel = vscode.window.createWebviewPanel(
        "plutoTerminalOutput",
        "Pluto Terminal Output",
        columnToShowIn,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist"),
          ],
        }
      );

      this.panels.set(outputId, panel);

      // Handle panel disposal
      panel.onDidDispose(() => {
        this.panels.delete(outputId);
      });
    } else {
      // Show existing panel
      panel.reveal(columnToShowIn);
    }

    // Update content
    panel.webview.html = this.getWebviewContent(panel.webview, context, result);
  }

  /**
   * Generate webview HTML content using the existing Pluto renderer
   */
  private static getWebviewContent(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
    result: CellResultData
  ): string {
    return terminalOutputHtml(result, {
      cspSource: webview.cspSource,
      cssUri: webview
        .asWebviewUri(
          vscode.Uri.joinPath(context.extensionUri, "dist", "renderer.css")
        )
        .toString(),
      rainbowVersion: __RAINBOW_VERSION__,
    });
  }

  /**
   * Dispose all panels
   */
  public static disposeAll(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}
