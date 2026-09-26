import * as vscode from "vscode";

/** Whether Pluto's hidden cells should show with their input collapsed. */
export function foldHiddenCellsEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("pluto-notebook")
    .get<boolean>("foldHiddenCells", true);
}
