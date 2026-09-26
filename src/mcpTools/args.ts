import { z } from "zod";

/**
 * A string argument naming a file. The mark is carried into the tool's
 * JSON Schema, so clients can tell which arguments are paths.
 */
export function pathArg(description: string) {
  return z.string().describe(description).meta({ "x-pluto-path": true });
}

export const notebookPath = pathArg("Absolute path of the notebook's .jl file");

export const cellId = z.string().describe("UUID of the cell (from list_cells)");

export const cellIds = z
  .array(z.string())
  .describe("Cell UUIDs (from list_cells), in the desired order");
