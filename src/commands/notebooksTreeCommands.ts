import * as vscode from "vscode";
import type { PlutoManager } from "../plutoManager.ts";
import type { PlutoNotebookTreeItem } from "../treeView/notebooksTreeDataProvider.ts";

async function revealNotebook(
  notebookPath: string
): Promise<vscode.NotebookDocument> {
  const uri = vscode.Uri.file(notebookPath);
  const notebookDocument = await vscode.workspace.openNotebookDocument(uri);
  await vscode.window.showNotebookDocument(notebookDocument, {
    preview: false,
  });
  return notebookDocument;
}

/**
 * A tree item's click passes the notebook path; its context menu passes the
 * tree item itself.
 */
export function notebookPathOf(
  target: string | Pick<PlutoNotebookTreeItem, "notebookPath">
): string {
  return typeof target === "string" ? target : target.notebookPath;
}

export async function openNotebookFromTree(
  target: string | PlutoNotebookTreeItem
): Promise<void> {
  try {
    await revealNotebook(notebookPathOf(target));
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to open notebook: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function focusCellFromTree(
  notebookPath: string,
  cellId: string
): Promise<void> {
  try {
    // Open the notebook document
    const document = await revealNotebook(notebookPath);

    // Find the cell with matching pluto_cell_id
    const cells = document.getCells();
    const cellIndex = cells.findIndex(
      (cell) => cell.metadata?.pluto_cell_id === cellId
    );

    if (cellIndex !== -1) {
      // Focus the cell by selecting it
      const editor = vscode.window.activeNotebookEditor;
      if (editor) {
        editor.selection = new vscode.NotebookRange(cellIndex, cellIndex + 1);
        // Reveal the cell
        editor.revealRange(
          new vscode.NotebookRange(cellIndex, cellIndex + 1),
          vscode.NotebookEditorRevealType.InCenter
        );
      }
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to focus cell: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function reconnectNotebook(
  plutoManager: PlutoManager,
  notebook: PlutoNotebookTreeItem
): Promise<void> {
  await plutoManager.restartNotebook(notebook.notebookPath);
}
