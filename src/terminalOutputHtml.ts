import type { CellResultData } from "@plutojl/rainbow";
import { toTransport } from "./outputKind.ts";

export interface TerminalOutputHtmlOptions {
  cspSource: string;
  cssUri: string;
  rainbowVersion: string;
}

/**
 * Browser source of the inverse of outputKind's toTransport, for the inline
 * webview script, which cannot import modules from the extension.
 */
export const TRANSPORT_DECODER_JS = `function fromTransport(value) {
  if (value === null || typeof value !== "object") return value;
  const base64 = value.$bytes;
  if (
    typeof base64 === "string" &&
    base64.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }
  for (const key of Object.keys(value)) value[key] = fromTransport(value[key]);
  return value;
}`;

/** JSON that can sit inside an inline <script> without ending it. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The terminal output webview page, rendering `result` with rainbow's OutputBody. */
export function terminalOutputHtml(
  result: CellResultData,
  options: TerminalOutputHtmlOptions
): string {
  const csp = htmlEscape(options.cspSource);
  const sent = { ...result, output: toTransport(result.output) };
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        script-src ${csp} 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;
        style-src ${csp} 'unsafe-inline' https://cdn.jsdelivr.net;
        img-src ${csp} data: https: blob:;
        font-src ${csp} data: https://cdn.jsdelivr.net;
        connect-src https: data:;
    ">
    <title>Pluto Terminal Output</title>
    <link rel="stylesheet" href="${htmlEscape(options.cssUri)}">
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
        <div class="mime-type">MIME: ${htmlEscape(result.output?.mime ?? "unknown")}</div>
    </div>
    <div class="output-container" id="output-root"></div>

    <script type="module">
        // Import from @plutojl/rainbow directly
        import { html, render, OutputBody, setup_mathjax } from ${scriptJson(`https://cdn.jsdelivr.net/npm/@plutojl/rainbow@${encodeURIComponent(options.rainbowVersion)}/ui/+esm`)};

        // Parse the result data
        const fromTransport = ${TRANSPORT_DECODER_JS};
        const sent = ${scriptJson(sent)};
        const result = { ...sent, output: fromTransport(sent.output) };

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
