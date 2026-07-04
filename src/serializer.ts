import * as vscode from "vscode";
import {
  parsePlutoNotebook,
  serializePlutoNotebook,
} from "./plutoSerializer.ts";
import type { CellResultData } from "@plutojl/rainbow";

export function formatCellOutput(
  output: CellResultData
): vscode.NotebookCellOutput {
  // Wrap output in custom renderer mimetype
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.json(output, "x-application/pluto-output"),
  ]);
}

export class PlutoNotebookSerializer implements vscode.NotebookSerializer {
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
    // No fallback on failure: writing anything but the real Pluto format
    // would corrupt the .pluto.jl file on disk. Let the save fail instead.
    const serialized = serializePlutoNotebook(
      data.cells,
      data.metadata?.pluto_notebook_id as string,
      data.metadata?.pluto_version as string
    );

    return new TextEncoder().encode(serialized);
  }
}
