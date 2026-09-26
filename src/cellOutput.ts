import * as vscode from "vscode";
import type { CellResultData } from "@plutojl/rainbow";

export function formatCellOutput(
  output: CellResultData
): vscode.NotebookCellOutput {
  // Wrap output in custom renderer mimetype
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.json(output, "x-application/pluto-output"),
  ]);
}
