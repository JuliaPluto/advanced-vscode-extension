/**
 * View Toggle Commands
 *
 * Commands for switching between code view (text editor) and notebook view
 */

import * as vscode from "vscode";
import { isPlutoNotebookFileName } from "../plutoFileName.ts";

/**
 * Toggle between code view (document) and notebook view
 */
export function registerToggleViewCommand(
  context: vscode.ExtensionContext
): void {
  const command = vscode.commands.registerCommand(
    "pluto-notebook.toggleView",
    async () => {
      const activeEditor = vscode.window.activeTextEditor;
      const activeNotebookEditor = vscode.window.activeNotebookEditor;

      // If we have an active notebook editor, switch to code view
      if (activeNotebookEditor) {
        const notebookUri = activeNotebookEditor.notebook.uri;

        // Close the notebook editor
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor"
        );

        // Open as text document
        const document = await vscode.workspace.openTextDocument(notebookUri);
        await vscode.window.showTextDocument(document);

        vscode.window.showInformationMessage("Switched to code view");
        return;
      }

      // If we have an active text editor with a Pluto file, switch to notebook view
      if (activeEditor) {
        const document = activeEditor.document;
        const fileName = document.fileName;

        // Check if it's a Pluto notebook file
        if (isPlutoNotebookFileName(fileName)) {
          const uri = document.uri;

          // Close the text editor
          await vscode.commands.executeCommand(
            "workbench.action.closeActiveEditor"
          );

          // Open as notebook
          await vscode.commands.executeCommand(
            "vscode.openWith",
            uri,
            "pluto-notebook"
          );

          vscode.window.showInformationMessage("Switched to notebook view");
          return;
        }
      }

      vscode.window.showWarningMessage(
        "No Pluto notebook open. Please open a .pluto.jl or .dyad.jl file."
      );
    }
  );

  context.subscriptions.push(command);
}
