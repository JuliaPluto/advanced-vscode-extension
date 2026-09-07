import * as vscode from "vscode";
import { getMcpEndpoint } from "../mcpServerDefinitionProvider.ts";
import { openUrl } from "./plutoServerCommands.ts";

/**
 * VS Code and its in-editor agents discover the server through the native
 * MCP server definition provider; a config file is only needed by clients
 * that run outside VS Code. Claude Code reads `.mcp.json` at the project
 * root. The tool server speaks streamable HTTP (legacy SSE fallback included).
 */
async function createClaudeCodeMCPConfig(mcpUrl: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder is open");
    return;
  }

  const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".mcp.json");

  try {
    let existingConfig: { mcpServers?: Record<string, unknown> } = {};

    try {
      const existingContent = await vscode.workspace.fs.readFile(configPath);
      existingConfig = JSON.parse(new TextDecoder().decode(existingContent));
    } catch {
      // File doesn't exist, use default empty config
    }

    existingConfig.mcpServers ??= {};
    existingConfig.mcpServers["pluto-notebook"] = {
      url: mcpUrl,
      type: "http",
    };

    const configContent = JSON.stringify(existingConfig, null, 2);
    await vscode.workspace.fs.writeFile(
      configPath,
      new TextEncoder().encode(configContent)
    );

    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      `Claude Code config created/updated at ${configPath.fsPath}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to create MCP config: ${errorMessage}`
    );
  }
}

/**
 * Command: Create Claude Code MCP config for current project
 */
export function registerCreateProjectMCPConfigCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pluto-notebook.createProjectMCPConfig",
      async () => {
        await createClaudeCodeMCPConfig(getMcpEndpoint().toString());
      }
    )
  );
}

/**
 * Command: Get MCP HTTP Server URL
 */
export function registerGetMCPHttpUrlCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pluto-notebook.getMCPHttpUrl",
      async () => {
        const mcpUrl = getMcpEndpoint().toString();

        const action = await vscode.window.showInformationMessage(
          `MCP HTTP Server URL: ${mcpUrl}. VS Code chat finds this server on its own; the config file is for Claude Code.`,
          "Copy URL",
          "Create Claude Code Config",
          "Open Health Check"
        );

        if (action === "Copy URL") {
          await vscode.env.clipboard.writeText(mcpUrl);
          vscode.window.showInformationMessage("URL copied to clipboard!");
        } else if (action === "Create Claude Code Config") {
          await createClaudeCodeMCPConfig(mcpUrl);
        } else if (action === "Open Health Check") {
          await openUrl(mcpUrl.replace(/\/mcp$/, "/health"));
        }
      }
    )
  );
}
