import * as vscode from "vscode";
import { getMCPServer } from "../mcp-server-http.ts";

/**
 * MCP URL of the running server (which may have moved to a fallback
 * port), or the configured port when it isn't running.
 */
function resolveMcpUrl(): string {
  const runningPort = getMCPServer()?.isRunning()
    ? getMCPServer()?.getPort()
    : undefined;
  const port =
    runningPort ??
    vscode.workspace
      .getConfiguration("pluto-notebook")
      .get<number>("mcpPort", 3100);
  return `http://localhost:${port}/mcp`;
}

/**
 * Generate MCP server configuration for Claude Code (.mcp.json).
 * The tool server speaks streamable HTTP (legacy SSE fallback included).
 */
function getClaudeConfig(mcpUrl: string): object {
  return {
    mcpServers: {
      "pluto-notebook": {
        url: mcpUrl,
        type: "http",
      },
    },
  };
}

/**
 * Generate MCP server configuration for GitHub Copilot (.vscode/mcp.json).
 */
function getCopilotConfig(mcpUrl: string): object {
  return {
    servers: {
      "pluto-notebook": {
        url: mcpUrl,
        type: "http",
      },
    },
    inputs: [],
  };
}

/**
 * Create or update MCP config in the current workspace
 */
async function createProjectMCPConfig(
  mcpUrl: string,
  configType: "claude" | "copilot"
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder is open");
    return;
  }

  const workspaceFolder = workspaceFolders[0];
  // Claude Code reads .mcp.json at the project root; VS Code reads
  // workspace MCP servers from .vscode/mcp.json
  const configPath =
    configType === "claude"
      ? vscode.Uri.joinPath(workspaceFolder.uri, ".mcp.json")
      : vscode.Uri.joinPath(workspaceFolder.uri, ".vscode", "mcp.json");

  try {
    // Try to read existing config
    let existingConfig: any = {};

    try {
      const existingContent = await vscode.workspace.fs.readFile(configPath);
      existingConfig = JSON.parse(new TextDecoder().decode(existingContent));
    } catch {
      // File doesn't exist, use default empty config
    }

    // Merge configurations
    const newConfig =
      configType === "claude"
        ? getClaudeConfig(mcpUrl)
        : getCopilotConfig(mcpUrl);

    if (configType === "claude") {
      existingConfig.mcpServers ??= {};
      existingConfig.mcpServers["pluto-notebook"] = (
        newConfig as any
      ).mcpServers["pluto-notebook"];
    } else {
      // Copilot config structure
      existingConfig.servers ??= {};
      existingConfig.servers["pluto-notebook"] = (newConfig as any).servers[
        "pluto-notebook"
      ];
      existingConfig.inputs ??= [];
    }

    // Write the config file
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(configPath, "..")
    );
    const configContent = JSON.stringify(existingConfig, null, 2);
    await vscode.workspace.fs.writeFile(
      configPath,
      new TextEncoder().encode(configContent)
    );

    // Open the file
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      `${configType === "claude" ? "Claude Code" : "Copilot"} config created/updated at ${configPath.fsPath}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to create MCP config: ${errorMessage}`
    );
  }
}

/**
 * Command: Create MCP config for current project
 */
export function registerCreateProjectMCPConfigCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pluto-notebook.createProjectMCPConfig",
      async () => {
        const mcpUrl = resolveMcpUrl();

        const choice = await vscode.window.showQuickPick(
          [
            {
              label: "Claude Code",
              description: "Create config for Claude Code (.mcp.json)",
              value: "claude" as const,
            },
            {
              label: "GitHub Copilot",
              description:
                "Create config for GitHub Copilot (.vscode/mcp.json)",
              value: "copilot" as const,
            },
          ],
          {
            placeHolder: "Select which tool to configure",
          }
        );

        if (choice) {
          await createProjectMCPConfig(mcpUrl, choice.value);
        }
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
        const mcpUrl = resolveMcpUrl();

        const action = await vscode.window.showInformationMessage(
          `MCP HTTP Server URL: ${mcpUrl}`,
          "Copy URL",
          "Create Claude Config",
          "Create Copilot Config",
          "Open Health Check"
        );

        if (action === "Copy URL") {
          await vscode.env.clipboard.writeText(mcpUrl);
          vscode.window.showInformationMessage("URL copied to clipboard!");
        } else if (action === "Create Claude Config") {
          await createProjectMCPConfig(mcpUrl, "claude");
        } else if (action === "Create Copilot Config") {
          await createProjectMCPConfig(mcpUrl, "copilot");
        } else if (action === "Open Health Check") {
          const healthUrl = mcpUrl.replace(/\/mcp$/, "/health");
          await vscode.env.openExternal(vscode.Uri.parse(healthUrl));
        }
      }
    )
  );
}
