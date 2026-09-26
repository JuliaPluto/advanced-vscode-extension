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

/**
 * The cell state sent to the renderer. While an execution is live for the
 * cell, its output reaches the renderer only through replaceOutput, so it
 * is left out.
 */
export function rendererCellState(
  state: CellResultData,
  executionLive: boolean
): Partial<CellResultData> {
  if (!executionLive) {
    return state;
  }
  const rest: Partial<CellResultData> = { ...state };
  delete rest.output;
  return rest;
}
