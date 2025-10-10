/**
 * Terminal Commands - Commands for managing Pluto terminals
 */

import * as vscode from "vscode";
import type { PlutoManager } from "../plutoManager.ts";
import { createPlutoTerminal } from "../plutoTerminal.ts";

/**
 * Register command to create a new Pluto terminal
 */
export function registerCreateTerminalCommand(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): void {
  const terminalOutputChannel =
    vscode.window.createOutputChannel("Pluto Terminal");
  context.subscriptions.push(terminalOutputChannel);

  const command = vscode.commands.registerCommand(
    "pluto-notebook.createTerminal",
    () => {
      createPlutoTerminal(plutoManager, terminalOutputChannel, context);
    }
  );

  context.subscriptions.push(command);
}
