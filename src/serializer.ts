import * as vscode from "vscode";
import {
  parsePlutoNotebook,
  serializePlutoNotebook,
} from "./plutoSerializer.ts";

/** Whether Pluto's hidden cells should show with their input collapsed. */
export function foldHiddenCellsEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("pluto-notebook")
    .get<boolean>("foldHiddenCells", true);
}
import type { CellResultData } from "@plutojl/rainbow";

export function formatCellOutput(
  output: CellResultData
): vscode.NotebookCellOutput {
  // Wrap output in custom renderer mimetype
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.json(output, "x-application/pluto-output"),
  ]);
}

/** Looks up the embedded package environment of an open notebook by its id. */
export type PackageCellsProvider = (
  notebookId: string
) => Promise<Record<string, string> | undefined>;

export class PlutoNotebookSerializer implements vscode.NotebookSerializer {
  /**
   * The package environment can change while a notebook runs and only Pluto
   * has the current text, so a save asks the provider first and falls back
   * to the cells read from the file.
   */
  constructor(private readonly packageCells?: PackageCellsProvider) {}

  public async deserializeNotebook(
    content: Uint8Array
    // __token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    const contents = new TextDecoder().decode(content);

    try {
      const parsed = parsePlutoNotebook(contents);

      // Create notebook data with metadata
      const notebookData = new vscode.NotebookData(parsed.cells);
      notebookData.metadata = {
        pluto_notebook_id: parsed.notebook_id,
        pluto_version: parsed.pluto_version,
        pluto_package_cells: parsed.package_cells,
      };
      return notebookData;
    } catch (error) {
      // Fallback: treat as single code cell if parsing fails
      const cell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        contents,
        "julia"
      );
      cell.outputs = [
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(
            error instanceof Error ? error.message : String(error),
            "text/plain"
          ),
        ]),
      ];
      return new vscode.NotebookData([cell]);
    }
  }

  public async serializeNotebook(
    data: vscode.NotebookData
    // __token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const notebookId = data.metadata?.pluto_notebook_id as string;
    const storedPackageCells = data.metadata?.pluto_package_cells as
      Record<string, string> | undefined;
    const packageCells =
      (notebookId && this.packageCells
        ? await this.packageCells(notebookId).catch(() => undefined)
        : undefined) ?? storedPackageCells;

    // No fallback on failure: writing anything but the real Pluto format
    // would corrupt the .pluto.jl file on disk. Let the save fail instead.
    const serialized = serializePlutoNotebook(
      data.cells,
      notebookId,
      data.metadata?.pluto_version as string,
      packageCells
    );

    return new TextEncoder().encode(serialized);
  }
}
