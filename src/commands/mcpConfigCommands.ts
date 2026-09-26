import * as vscode from "vscode";
import { getMcpEndpoint } from "../mcpServerDefinitionProvider.ts";
import { MCP_SERVER_NAME, upsertMcpServer } from "../mcpClientConfig.ts";
import { openUrl } from "./plutoServerCommands.ts";

/** A missing file reads as `undefined`; any other read failure throws. */
async function readConfigText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    if (
      error instanceof vscode.FileSystemError &&
      error.code === "FileNotFound"
    ) {
      return undefined;
    }
    throw error;
  }
}

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
    let result = upsertMcpServer(await readConfigText(configPath), {
      format: "claude-code",
      url: mcpUrl,
    });
    if (result.kind === "exists" && !result.current) {
      const overwrite = await vscode.window.showWarningMessage(
        `Overwrite existing ${MCP_SERVER_NAME} entry?`,
        {
          modal: true,
          detail: `${configPath.fsPath} already configures ${MCP_SERVER_NAME} with different settings.`,
        },
        "Overwrite"
      );
      if (overwrite !== "Overwrite") return;
      result = upsertMcpServer(await readConfigText(configPath), {
        format: "claude-code",
        url: mcpUrl,
        force: true,
      });
    }
    if (result.kind === "invalid") {
      vscode.window.showErrorMessage(
        `${configPath.fsPath} ${result.reason}; fix it and try again. The file was not changed.`
      );
      return;
    }
    if (result.kind === "updated") {
      await vscode.workspace.fs.writeFile(
        configPath,
        new TextEncoder().encode(result.text)
      );
    }

    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      result.kind === "updated"
        ? `Claude Code config created/updated at ${configPath.fsPath}`
        : `Claude Code config at ${configPath.fsPath} already points at this server`
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
