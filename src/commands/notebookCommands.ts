import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { serializePlutoNotebook } from "../plutoSerializer.ts";
import { resolveIncludes } from "@plutojl/rainbow";

/**
 * User-provided function that bundles the project into a string
 * Replace this function with your own implementation
 */
async function bundleProjectToString(): Promise<string> {
  // TODO: Replace this with your actual bundling logic
  // This function should return a string containing your bundled project code
  const content = await vscode.workspace.fs.readDirectory(
    vscode.Uri.file("./src/")
  );
  const juliaFiles = content
    .filter(
      ([name, type]) => type === vscode.FileType.File && name.endsWith(".jl")
    )
    .map(([name]) => name);

  const module = resolveIncludes(vscode.workspace.fs, `./src/${juliaFiles[0]}`);

  // Create analyses directory if it doesn't exist
  const analysesDir = vscode.Uri.file("./analyses");
  try {
    await vscode.workspace.fs.createDirectory(analysesDir);
  } catch {
    // Directory might already exist, ignore error
  }

  // Create filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `analysis-${timestamp}.jl`;
  const filePath = vscode.Uri.joinPath(analysesDir, filename);

  // Write the module content to the file
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(filePath, encoder.encode(module));

  return filePath.fsPath;
}

/**
 * Command: Bundle Project into Cell
 * Runs the bundleProjectToString function and adds the result as a new cell
 */
export function registerBundleProjectToCellCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pluto-notebook.bundleProjectToCell",
      async () => {
        try {
          // Get the active notebook editor
          const notebookEditor = vscode.window.activeNotebookEditor;
          if (!notebookEditor) {
            vscode.window.showErrorMessage("No active notebook editor found");
            return;
          }

          const notebook = notebookEditor.notebook;
          if (notebook.notebookType !== "pluto-notebook") {
            vscode.window.showErrorMessage(
              "Active notebook is not a Pluto notebook"
            );
            return;
          }

          // Show progress while bundling
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Bundling project...",
              cancellable: false,
            },
            async () => {
              // Call the user-provided function to get the bundled string
              const bundledCode = await bundleProjectToString();

              // Create a new code cell with the bundled content
              const newCell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                bundledCode,
                "julia"
              );

              // Insert the cell at the end of the notebook
              const cellCount = notebook.cellCount;
              const edit = new vscode.WorkspaceEdit();
              edit.set(notebook.uri, [
                vscode.NotebookEdit.insertCells(cellCount, [newCell]),
              ]);

              await vscode.workspace.applyEdit(edit);

              vscode.window.showInformationMessage(
                "Project bundled into new cell successfully"
              );
            }
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to bundle project: ${errorMessage}`
          );
        }
      }
    )
  );
}

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
          const filePath = path.join(workspaceFolder.uri.fsPath, filename);

          // Check if file already exists
          if (fs.existsSync(filePath)) {
            const overwrite = await vscode.window.showWarningMessage(
              `File ${filename} already exists. Overwrite?`,
              "Yes",
              "No"
            );
            if (overwrite !== "Yes") {
              return;
            }
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
          fs.writeFileSync(filePath, notebookContent, "utf-8");

          // Open the file in VSCode
          const document = await vscode.workspace.openNotebookDocument(
            vscode.Uri.file(filePath)
          );
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
