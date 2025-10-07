import * as vscode from "vscode";

/**
 * Generate MCP server configuration for Claude Desktop
 */
function getClaudeConfig(mcpUrl: string): object {
  return {
    mcpServers: {
      "pluto-notebook": {
        url: mcpUrl,
        transport: "sse",
      },
    },
  };
}

/**
 * Generate MCP server configuration for GitHub Copilot
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
  const configFileName = configType === "claude" ? ".mcp.json" : "mcp.json";
  const configPath = vscode.Uri.joinPath(workspaceFolder.uri, configFileName);

  try {

    // Try to read existing config
    let existingConfig: any = {};

    try {
      const existingContent = await vscode.workspace.fs.readFile(configPath);
      existingConfig = JSON.parse(new TextDecoder().decode(existingContent));
    } catch (error) {
      // File doesn't exist, use default empty config
    }

    // Merge configurations
    const newConfig =
      configType === "claude"
        ? getClaudeConfig(mcpUrl)
        : getCopilotConfig(mcpUrl);

    if (configType === "claude") {
      if (!existingConfig.mcpServers) {
        existingConfig.mcpServers = {};
      }
      existingConfig.mcpServers["pluto-notebook"] = (newConfig as any)
        .mcpServers["pluto-notebook"];
    } else {
      // Copilot config structure
      if (!existingConfig.servers) {
        existingConfig.servers = {};
      }
      existingConfig.servers["pluto-notebook"] = (newConfig as any).servers[
        "pluto-notebook"
      ];
      if (!existingConfig.inputs) {
        existingConfig.inputs = [];
      }
    }

    // Write the config file
    const configContent = JSON.stringify(existingConfig, null, 2);
    await vscode.workspace.fs.writeFile(
      configPath,
      new TextEncoder().encode(configContent)
    );

    // Open the file
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      `${configType === "claude" ? "Claude Desktop" : "Copilot"} config created/updated at ${configPath.fsPath}`
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
        const config = vscode.workspace.getConfiguration("pluto-notebook");
        const mcpPort = config.get<number>("mcpPort", 3100);
        const mcpUrl = `http://localhost:${mcpPort}/mcp`;

        const choice = await vscode.window.showQuickPick(
          [
            {
              label: "Claude Desktop",
              description: "Create config for Claude Desktop (.mcp.json)",
              value: "claude" as const,
            },
            {
              label: "GitHub Copilot",
              description: "Create config for GitHub Copilot (mcp.json)",
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
        const config = vscode.workspace.getConfiguration("pluto-notebook");
        const mcpPort = config.get<number>("mcpPort", 3100);
        const mcpUrl = `http://localhost:${mcpPort}/mcp`;

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
          const healthUrl = `http://localhost:${mcpPort}/health`;
          await vscode.env.openExternal(vscode.Uri.parse(healthUrl));
        }
      }
    )
  );
}
