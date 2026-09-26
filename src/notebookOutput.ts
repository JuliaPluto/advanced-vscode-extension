import { randomUUID } from "crypto";
import { classifyOutput, outputBytes, outputText } from "./outputKind.ts";

/** Longest text body returned inline in a cell result. */
export const INLINE_TEXT_LIMIT = 4_000;
/** Longest serialized tree (Pluto object view) returned inline in a cell result. */
export const INLINE_TREE_LIMIT = 8_000;

const FETCH_HINT =
  'use read_cell_output with as: "text", "file", or "image" to fetch it';
const IMAGE_HINT =
  'use read_cell_output with as: "image" to see it, or as: "file" / "text" for the original output';

/** Image mimes a tool response can carry as an image content block. */
const IMAGE_BLOCK_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function isImageBlockMime(mime: string): boolean {
  return IMAGE_BLOCK_MIMES.has(mime);
}

export function extensionFor(mime: string): string {
  const known: Record<string, string> = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "text/html": "html",
    "text/plain": "txt",
    "text/markdown": "md",
    "application/pdf": "pdf",
    "application/json": "json",
    "application/vnd.pluto.tree+object": "json",
    "application/vnd.pluto.table+object": "json",
  };
  return known[mime] ?? "bin";
}

export interface FullOutput {
  mime: string;
  /** Body as bytes, whatever Pluto sent. */
  bytes: Uint8Array;
  /** Body as text for textual mimes and structured bodies (serialized JSON). */
  text: string | undefined;
}

/** The complete body of a cell output, for tools that hand it over whole. */
export function fullOutput(output: unknown): FullOutput | undefined {
  const bytes = outputBytes(output);
  if (!bytes) return undefined;
  return {
    mime: classifyOutput(output).mime,
    bytes,
    text: outputText(output),
  };
}

/**
 * Make a cell output compact enough for a tool response. A body whose mime
 * is textual is cut at INLINE_TEXT_LIMIT, except an SVG over the limit, and
 * a structured body at INLINE_TREE_LIMIT. Any other body is replaced by its
 * size, each with a note on how to fetch it.
 */
export function presentOutput(output: unknown): unknown {
  if (output === null || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  const kind = classifyOutput(record);

  if (kind.body === "empty") return record;

  if (kind.body === "structured") {
    if (kind.size <= INLINE_TREE_LIMIT) return record;
    return {
      ...record,
      body: null,
      bytes: kind.size,
      body_note: `${kind.mime} output of ${kind.size} characters is not returned inline; ${FETCH_HINT}`,
    };
  }

  const text = kind.mimeTextual ? outputText(record) : undefined;
  if (
    text === undefined ||
    (kind.family === "image" && text.length > INLINE_TEXT_LIMIT)
  ) {
    return {
      ...record,
      body: null,
      bytes: kind.size,
      body_note: `${kind.mime} output of ${kind.size} bytes is not returned inline; ${kind.family === "image" ? IMAGE_HINT : FETCH_HINT}`,
    };
  }

  if (text.length <= INLINE_TEXT_LIMIT) return { ...record, body: text };
  return {
    ...record,
    body: text.slice(0, INLINE_TEXT_LIMIT),
    body_note: `truncated to ${INLINE_TEXT_LIMIT} of ${text.length} characters; ${FETCH_HINT}`,
  };
}

/**
 * A new Pluto notebook file with one cell: a folded markdown title cell when
 * a title is given, otherwise an empty code cell.
 */
export function newNotebookSource(title?: string): string {
  const id = randomUUID();
  const cell = title ? ['md"""', `# ${title.replace(/"/g, "'")}`, '"""'] : [""];
  return [
    "### A Pluto.jl notebook ###",
    "# v0.20.0",
    "",
    "using Markdown",
    "using InteractiveUtils",
    "",
    `# ╔═╡ ${id}`,
    ...cell,
    "",
    "# ╔═╡ Cell order:",
    `# ${title ? "╟─" : "╠═"}${id}`,
    "",
  ].join("\n");
}

/**
 * Julia code that renders the current value of a cell to a PNG file
 * through its `image/png` show method. Runs inside the notebook, where
 * PlutoRunner keeps every cell's last value.
 */
export function renderCellToPngCode(cellId: string, pngPath: string): string {
  const escapedPath = pngPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    "let",
    `    results = Main.PlutoRunner.cell_results`,
    `    id = Base.UUID("${cellId}")`,
    `    haskey(results, id) || error("cell ${cellId} has no value to render")`,
    `    v = results[id]`,
    `    showable(MIME("image/png"), v) || error("the cell's value (" * string(typeof(v)) * ") cannot be rendered as image/png")`,
    `    open(io -> show(io, MIME("image/png"), v), "${escapedPath}", "w")`,
    `    filesize("${escapedPath}")`,
    "end",
  ].join("\n");
}
