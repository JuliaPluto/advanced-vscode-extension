import * as vscode from "vscode";
import { getMCPServer, startMCPServer } from "./mcp-server-http.ts";

/** Must match `contributes.mcpServerDefinitionProviders[].id` in package.json. */
export const MCP_SERVER_DEFINITION_PROVIDER_ID = "pluto-notebook.mcpServers";

const MCP_SERVER_LABEL = "Pluto Notebook";

/**
 * MCP endpoint of this window's server: the port it actually listens on
 * once started (it moves when the configured one is busy), otherwise the
 * configured one.
 */
export function getMcpEndpoint(): vscode.Uri {
  const port =
    getMCPServer()?.getPort() ??
    vscode.workspace
      .getConfiguration("pluto-notebook")
      .get<number>("mcpPort", 3100);
  return vscode.Uri.parse(`http://localhost:${port}/mcp`);
}

/**
 * Expose the bundled MCP HTTP server to VS Code's native MCP support, so
 * Copilot Chat and other in-editor agents discover it without a config file.
 * The server is started on demand when the editor resolves the definition.
 */
export function registerMcpServerDefinitionProvider(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): void {
  const lm = (vscode as Partial<typeof vscode>).lm;
  if (typeof lm?.registerMcpServerDefinitionProvider !== "function") {
    outputChannel.appendLine(
      "This editor has no native MCP server support; use a config file to connect MCP clients"
    );
    return;
  }

  const didChange = new vscode.EventEmitter<void>();
  context.subscriptions.push(didChange);

  const server = getMCPServer();
  if (server) {
    const unsubscribe = server.onDidChangeState(() => didChange.fire());
    context.subscriptions.push({ dispose: unsubscribe });
  }

  context.subscriptions.push(
    lm.registerMcpServerDefinitionProvider(MCP_SERVER_DEFINITION_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: didChange.event,
      provideMcpServerDefinitions: () => [
        new vscode.McpHttpServerDefinition(MCP_SERVER_LABEL, getMcpEndpoint()),
      ],
      resolveMcpServerDefinition: async (definition) => {
        await startMCPServer(outputChannel);
        if (definition instanceof vscode.McpHttpServerDefinition) {
          definition.uri = getMcpEndpoint();
        }
        return definition;
      },
    })
  );
  outputChannel.appendLine(
    `Registered "${MCP_SERVER_LABEL}" with VS Code's MCP server list`
  );
}
