import * as vscode from "vscode";
import type { CellResultData } from "@plutojl/rainbow";
import { serializeCellResult } from "./outputSerialization.ts";

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
    const rendererCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "renderer.css")
    );

    // Serialize the result data
    const resultJson = JSON.stringify(serializeCellResult(result));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;
        style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net;
        img-src ${webview.cspSource} data: https: blob:;
        font-src ${webview.cspSource} data: https://cdn.jsdelivr.net;
        connect-src https: data:;
    ">
    <title>Pluto Terminal Output</title>
    <link rel="stylesheet" href="${rendererCssUri}">
    <style>
        body {
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        .output-container {
            max-width: 100%;
            overflow-x: auto;
        }
        .output-header {
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .mime-type {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="output-header">
        <h3>Terminal Output</h3>
        <div class="mime-type">MIME: ${result.output?.mime ?? "unknown"}</div>
    </div>
    <div class="output-container" id="output-root"></div>

    <script type="module">
        // Import from @plutojl/rainbow directly
        import { html, render, OutputBody, setup_mathjax } from 'https://cdn.jsdelivr.net/npm/@plutojl/rainbow@${__RAINBOW_VERSION__}/ui/+esm';

        // Parse the result data
        const result = ${resultJson};
        const encodedBody = result.output?.body;
        if (encodedBody?.__pluto_binary_body_base64__ === "base64") {
            const binary = atob(encodedBody.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            result.output.body = bytes;
        }

        // Initialize MathJax if needed
        setup_mathjax();

        // Render the output using OutputBody from rainbow
        const root = document.getElementById('output-root');

        if (result.output?.body !== undefined) {
            render(
                html\`<\${OutputBody}
                    persist_js_state=\${true}
                    body=\${result.output.body}
                    mime=\${result.output.mime}
                    sanitize_html=\${false}
                />\`,
                root
            );
        } else {
            root.innerHTML = '<p style="color: #999;">No output</p>';
        }
    </script>
</body>
</html>`;
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
