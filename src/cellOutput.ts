import * as vscode from "vscode";
import type { CellResultData } from "@plutojl/rainbow";
import { serializeCellResult } from "./outputSerialization.ts";

export function formatCellOutput(
  output: CellResultData
): vscode.NotebookCellOutput {
  // Wrap output in custom renderer mimetype
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.json(
      serializeCellResult(output),
      "x-application/pluto-output"
    ),
  ]);
}
