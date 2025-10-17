/**
 * Commands module - organized by domain
 *
 * This module exports all command registration functions grouped by their domain:
 * - Pluto Server: Commands for managing the Pluto Julia server
 * - MCP Server: Commands for managing the MCP HTTP server
 * - MCP Config: Commands for configuring MCP clients (Claude, Copilot)
 */

import type * as vscode from "vscode";
import type { PlutoManager } from "../plutoManager.ts";

// Re-export all commands from domain-specific modules
export * from "./plutoServerCommands.ts";
export * from "./mcpServerCommands.ts";
export * from "./mcpConfigCommands.ts";
export * from "./terminalCommands.ts";
export * from "./notebooksTreeCommands.ts";
export * from "./viewToggleCommands.ts";
export * from "./notebookCommands.ts";
// Import for registerAllCommands
import {
  registerStartServerCommand,
  registerStopServerCommand,
  registerRestartServerCommand,
  registerOpenInBrowserCommand,
  registerToggleServerCommand,
} from "./plutoServerCommands.ts";

import {
  registerStartMCPServerCommand,
  registerStopMCPServerCommand,
  registerRestartMCPServerCommand,
} from "./mcpServerCommands.ts";

import {
  registerCreateProjectMCPConfigCommand,
  registerGetMCPHttpUrlCommand,
} from "./mcpConfigCommands.ts";

import {
  registerFocusCellCommand,
  registerRevealNotebookCommand,
  registerReconnectCommand,
} from "./notebooksTreeCommands.ts";
import { registerCreateTerminalCommand } from "./terminalCommands.ts";
import { registerToggleViewCommand } from "./viewToggleCommands.ts";
import {
  registerCreateNewNotebookCommand,
  registerBundleProjectToCellCommand,
} from "./notebookCommands.ts";

/**
 * Register all commands at once
 *
 * This is a convenience function that registers all commands from all domains.
 * It's called during extension activation.
 *
 * @param context - Extension context for registering commands
 * @param plutoManager - Shared PlutoManager instance
 */
export function registerAllCommands(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): void {
  // Register Pluto Server commands
  registerStartServerCommand(context, plutoManager);
  registerStopServerCommand(context, plutoManager);
  registerRestartServerCommand(context, plutoManager);
  registerOpenInBrowserCommand(context, plutoManager);
  registerToggleServerCommand(context, plutoManager);

  // Register MCP Server commands
  registerStartMCPServerCommand(context);
  registerStopMCPServerCommand(context);
  registerRestartMCPServerCommand(context);

  // Register MCP Config commands
  registerCreateProjectMCPConfigCommand(context);
  registerGetMCPHttpUrlCommand(context);

  // Register Terminal commands
  registerCreateTerminalCommand(context, plutoManager);
  registerFocusCellCommand(context);
  registerRevealNotebookCommand(context);
  registerReconnectCommand(context, plutoManager);

  // Register View Toggle commands
  registerToggleViewCommand(context);

  // Register Notebook commands
  registerCreateNewNotebookCommand(context);
  registerBundleProjectToCellCommand(context);
}
