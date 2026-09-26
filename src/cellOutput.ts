import * as vscode from "vscode";
import type { CellResultData } from "@plutojl/rainbow";
import { toTransport } from "./outputKind.ts";

export function formatCellOutput(
  output: CellResultData
): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.json(
      withTransportOutput(output),
      "x-application/pluto-output"
    ),
  ]);
}

/**
 * The cell state sent to the renderer, with its output in transport form.
 * While an execution is live for the cell, its output reaches the renderer
 * only through replaceOutput, so it is left out.
 */
export function rendererCellState(
  state: CellResultData,
  executionLive: boolean
): Partial<CellResultData> {
  if (!executionLive) {
    return withTransportOutput(state);
  }
  const rest: Partial<CellResultData> = { ...state };
  delete rest.output;
  return rest;
}

function withTransportOutput(state: CellResultData): CellResultData {
  const output = toTransport(state.output);
  return output === state.output ? state : { ...state, output };
}
