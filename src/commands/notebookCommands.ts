import * as vscode from "vscode";
import { serializePlutoNotebook } from "../plutoSerializer.ts";

/**
 * Command: Create New Pluto Notebook
 * Prompts for a filename and creates a new Pluto notebook with one empty cell
 */
export function registerCreateNewNotebookCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pluto-notebook.createNewNotebook",
      async () => {
        try {
          // Get the workspace folder
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(
              "No workspace folder open. Please open a folder first."
            );
            return;
          }

          // Prompt for filename
          const filename = await vscode.window.showInputBox({
            prompt: "Enter notebook filename",
            placeHolder: "my-notebook.pluto.jl",
            validateInput: (value) => {
              if (!value) {
                return "Filename cannot be empty";
              }
              if (!value.endsWith(".pluto.jl") && !value.endsWith(".dyad.jl")) {
                return "Filename must end with .pluto.jl or .dyad.jl";
              }
              return null;
            },
          });

          if (!filename) {
            // User cancelled
            return;
          }

          // Get the file path
          const workspaceFolder = workspaceFolders[0];
          const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filename);

          // Check if file already exists
          try {
            await vscode.workspace.fs.stat(fileUri);
            // File exists, ask for confirmation
            const overwrite = await vscode.window.showWarningMessage(
              `File ${filename} already exists. Overwrite?`,
              "Yes",
              "No"
            );
            if (overwrite !== "Yes") {
              return;
            }
          } catch {
            // File doesn't exist, proceed
          }

          // Create a single empty cell
          const emptyCell = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            "",
            "julia"
          );

          // Serialize the notebook with the empty cell
          const notebookContent = serializePlutoNotebook([emptyCell]);

          // Write to file
          const encoder = new TextEncoder();
          await vscode.workspace.fs.writeFile(
            fileUri,
            encoder.encode(notebookContent)
          );

          // Open the file in VSCode
          const document = await vscode.workspace.openNotebookDocument(fileUri);
          await vscode.window.showNotebookDocument(document);

          vscode.window.showInformationMessage(
            `Created new Pluto notebook: ${filename}`
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to create notebook: ${errorMessage}`
          );
        }
      }
    )
  );
}
