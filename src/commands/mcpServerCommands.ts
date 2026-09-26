import * as vscode from "vscode";
import { getMCPServer } from "../mcp-server-http.ts";

export async function startMcpServer(): Promise<void> {
  const mcpServer = getMCPServer();

  if (!mcpServer) {
    vscode.window.showErrorMessage("MCP server is not initialized");
    return;
  }

  if (mcpServer.isRunning()) {
    vscode.window.showInformationMessage("MCP server is already running");
    return;
  }

  try {
    await mcpServer.start();
    // getPort() after start — the server may have moved to a free
    // port when the configured one was taken
    vscode.window.showInformationMessage(
      `MCP Server started on http://localhost:${mcpServer.getPort()}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to start MCP server: ${errorMessage}`
    );
  }
}

export async function stopMcpServer(): Promise<void> {
  const mcpServer = getMCPServer();

  if (!mcpServer) {
    vscode.window.showErrorMessage("MCP server is not initialized");
    return;
  }

  if (!mcpServer.isRunning()) {
    vscode.window.showInformationMessage("MCP server is not running");
    return;
  }

  try {
    await mcpServer.stop();
    vscode.window.showInformationMessage("MCP Server stopped");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to stop MCP server: ${errorMessage}`
    );
  }
}

export async function restartMcpServer(): Promise<void> {
  const mcpServer = getMCPServer();

  if (!mcpServer) {
    vscode.window.showErrorMessage("MCP server is not initialized");
    return;
  }

  try {
    if (mcpServer.isRunning()) {
      await mcpServer.stop();
    }

    await mcpServer.start();
    vscode.window.showInformationMessage(
      `MCP Server restarted on http://localhost:${mcpServer.getPort()}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to restart MCP server: ${errorMessage}`
    );
  }
}
