import { randomUUID } from "crypto";

/** Longest text body returned inline in a cell result. */
export const INLINE_TEXT_LIMIT = 4_000;
/** Longest serialized tree (Pluto object view) returned inline in a cell result. */
export const INLINE_TREE_LIMIT = 8_000;

const TEXT_MIME = /^(text\/|image\/svg|application\/(json|javascript|xml))/;
const IMAGE_MIME = /^image\//;
const RASTER_MIME = /^image\/(png|jpeg|gif|webp)$/;
/** Mimes whose bodies are never returned inline, only through read_cell_output. */
const HEAVY_MIME = /^(image\/|application\/pdf|application\/octet-stream)/;

const FETCH_HINT =
  'use read_cell_output with as: "text", "file", or "image" to fetch it';

function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return undefined;
}

export function isTextMime(mime: string): boolean {
  return TEXT_MIME.test(mime);
}

export function isImageMime(mime: string): boolean {
  return IMAGE_MIME.test(mime);
}

export function isRasterMime(mime: string): boolean {
  return RASTER_MIME.test(mime);
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
  /** Body as text for text-like mimes and tree objects (serialized JSON). */
  text: string | undefined;
}

/** The complete body of a cell output, decoded once, for tools that hand it over whole. */
export function fullOutput(output: unknown): FullOutput | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const record = output as Record<string, unknown>;
  const mime = typeof record.mime === "string" ? record.mime : "text/plain";
  const body = record.body;
  const bytes = bytesOf(body);
  if (bytes) {
    return {
      mime,
      bytes,
      text: isTextMime(mime) ? new TextDecoder().decode(bytes) : undefined,
    };
  }
  if (typeof body === "string") {
    return { mime, bytes: new TextEncoder().encode(body), text: body };
  }
  if (body === undefined || body === null) return undefined;
  const text = JSON.stringify(body);
  return { mime, bytes: new TextEncoder().encode(text), text };
}

/**
 * Make a cell output compact enough for a tool response. Image and other
 * heavy bodies are replaced by their size; text is cut at
 * INLINE_TEXT_LIMIT and tree objects at INLINE_TREE_LIMIT, each with a
 * note on how to fetch the whole thing.
 */
export function presentOutput(output: unknown): unknown {
  if (output === null || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  const mime = typeof record.mime === "string" ? record.mime : "";
  let body = record.body;
  const bytes = bytesOf(body);

  if (HEAVY_MIME.test(mime)) {
    const size =
      bytes?.length ?? (typeof body === "string" ? body.length : undefined);
    return {
      ...record,
      body: null,
      bytes: size,
      body_note: `${mime} output${size !== undefined ? ` of ${size} bytes` : ""} is not returned inline; ${FETCH_HINT}`,
    };
  }

  if (bytes) {
    body = new TextDecoder().decode(bytes);
  }

  if (typeof body === "string") {
    if (body.length <= INLINE_TEXT_LIMIT) return { ...record, body };
    return {
      ...record,
      body: body.slice(0, INLINE_TEXT_LIMIT),
      body_note: `truncated to ${INLINE_TEXT_LIMIT} of ${body.length} characters; ${FETCH_HINT}`,
    };
  }

  if (body !== null && typeof body === "object") {
    const size = JSON.stringify(body).length;
    if (size <= INLINE_TREE_LIMIT) return { ...record, body };
    return {
      ...record,
      body: null,
      bytes: size,
      body_note: `${mime || "structured"} output of ${size} characters is not returned inline; ${FETCH_HINT}`,
    };
  }

  return { ...record, body };
}

/** Minimal Pluto notebook file, with one markdown title cell when a title is given. */
export function newNotebookSource(title?: string): string {
  const header = [
    "### A Pluto.jl notebook ###",
    "# v0.20.0",
    "",
    "using Markdown",
    "using InteractiveUtils",
    "",
  ];
  if (!title) {
    return [...header, "# ╔═╡ Cell order:", ""].join("\n");
  }
  const id = randomUUID();
  const safeTitle = title.replace(/"/g, "'");
  return [
    ...header,
    `# ╔═╡ ${id}`,
    'md"""',
    `# ${safeTitle}`,
    '"""',
    "",
    "# ╔═╡ Cell order:",
    `# ╟─${id}`,
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
