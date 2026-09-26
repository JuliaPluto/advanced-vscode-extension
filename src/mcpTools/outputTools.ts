import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import { tmpdir } from "os";
import type { Worker } from "@plutojl/rainbow";
import { z } from "zod";
import {
  extensionFor,
  fullOutput,
  isImageBlockMime,
  renderCellToPngCode,
} from "../notebookOutput.ts";
import { cellId, pathArg } from "./args.ts";
import {
  EXECUTION_TIMEOUT_MS,
  content,
  execution,
  notebookTool,
  type PlutoTool,
  type PlutoToolsManager,
} from "./tool.ts";

async function renderPng(
  manager: PlutoToolsManager,
  worker: Worker,
  cell_id: string,
  mime: string
): Promise<Buffer> {
  const canWrite = manager.capabilities().writeLocalFile;
  if (!canWrite.ok) {
    throw new Error(
      `The cell's output is ${mime}. ${canWrite.reason} Use as: "file" with a .${extensionFor(mime)} name to save the original output instead.`
    );
  }
  const pngPath = join(tmpdir(), `pluto-cell-${cell_id}-${Date.now()}.png`);
  try {
    const render = await manager.executeCodeEphemeral(
      worker,
      renderCellToPngCode(cell_id, pngPath)
    );
    if (render.errored) {
      const why = fullOutput(render.output)?.text ?? "unknown error";
      throw new Error(
        `Could not render cell ${cell_id} as PNG: ${why.slice(0, 500)}. Use as: "file" with a .${extensionFor(mime)} name to save the ${mime} output instead.`
      );
    }
    return await readFile(pngPath);
  } finally {
    await rm(pngPath, { force: true });
  }
}

export function outputTools(manager: PlutoToolsManager): PlutoTool[] {
  return [
    notebookTool(manager, {
      name: "read_cell_output",
      description:
        'Fetch a cell\'s complete output, which cell results only summarize. as: "text" returns the full body (SVG/HTML markup, long text, tree JSON); "file" writes it next to the notebook (or to output_path) and returns the path — the way to look at a plot with your own file tools; "image" returns it as an image content block, rendering non-raster values such as SVG plots to PNG inside the notebook first.',
      args: {
        cell_id: cellId,
        as: z
          .enum(["text", "file", "image"])
          .describe("How to return the output (default text)")
          .optional()
          .default("text"),
        output_path: pathArg(
          'For as: "file" — where to write; defaults to <notebook>.assets/<cell_id>.<ext>'
        ).optional(),
      },
      bound: execution((args) =>
        args.as === "text"
          ? `read_cell_output has not finished after ${EXECUTION_TIMEOUT_MS / 1000}s; the connection to the notebook may be stalled — check get_notebook_status, then call read_cell_output again.`
          : `Rendering the cell's output to PNG is still running after ${EXECUTION_TIMEOUT_MS / 1000}s. It keeps executing in a temporary cell that is deleted automatically when it finishes — use wait_for_notebook_idle, then call read_cell_output again${args.as === "file" ? "; nothing was written" : ""}.`
      ),
      run: async ({ path, cell_id, as, output_path }, worker, signal) => {
        const snippet = worker.getSnippet(cell_id);
        if (!snippet) {
          throw new Error(`Cell ${cell_id} not found — use list_cells`);
        }
        const output = fullOutput(snippet.result.output);
        if (!output) {
          throw new Error(`Cell ${cell_id} has no output`);
        }

        if (as === "text") {
          return {
            cell_id,
            mime: output.mime,
            bytes: output.bytes.length,
            encoding: output.text === undefined ? "base64" : "utf-8",
            body: output.text ?? Buffer.from(output.bytes).toString("base64"),
          };
        }

        if (as === "file") {
          const nativeExt = extensionFor(output.mime);
          const dest =
            output_path ??
            join(
              dirname(path),
              `${basename(path, extname(path))}.assets`,
              `${cell_id}.${nativeExt}`
            );
          const wantedExt = extname(dest).slice(1).toLowerCase();
          let bytes: Uint8Array = output.bytes;
          let mime = output.mime;
          if (wantedExt && wantedExt !== nativeExt) {
            // The caller named a format: render to it when possible, refuse otherwise
            if (wantedExt === "png" && !isImageBlockMime(output.mime)) {
              bytes = await renderPng(manager, worker, cell_id, output.mime);
              mime = "image/png";
            } else if (!(wantedExt === "jpg" && nativeExt === "jpg")) {
              throw new Error(
                `The cell's output is ${output.mime}, which is written as .${nativeExt}; name the file that way, or use .png to have it rendered${isImageBlockMime(output.mime) ? "" : " inside the notebook"}.`
              );
            }
          }
          await mkdir(dirname(dest), { recursive: true });
          signal.throwIfAborted();
          await writeFile(dest, bytes);
          return `Wrote ${bytes.length} bytes of ${mime} to ${dest}`;
        }

        if (isImageBlockMime(output.mime)) {
          return content([
            {
              type: "image",
              data: Buffer.from(output.bytes).toString("base64"),
              mimeType: output.mime,
            },
            {
              type: "text",
              text: `${output.mime}, ${output.bytes.length} bytes`,
            },
          ]);
        }
        const png = await renderPng(manager, worker, cell_id, output.mime);
        return content([
          {
            type: "image",
            data: png.toString("base64"),
            mimeType: "image/png",
          },
          {
            type: "text",
            text: `Rendered the cell's ${output.mime} output to image/png (${png.length} bytes)`,
          },
        ]);
      },
    }),
  ];
}
