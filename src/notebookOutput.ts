import { randomUUID } from "crypto";

/** Longest output body returned inline by a tool; longer bodies are cut with a note. */
const OUTPUT_BODY_LIMIT = 32_000;

const TEXT_MIME = /^(text\/|image\/svg|application\/(json|javascript|xml))/;
const BINARY_MIME = /^(image\/|application\/pdf|application\/octet-stream)/;

function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return undefined;
}

/**
 * Make a cell output safe and compact for a JSON tool response: byte
 * bodies become text or base64 depending on the mime type, and long
 * bodies are truncated with a note on how to get the whole thing.
 */
export function presentOutput(output: unknown): unknown {
  if (output === null || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  const mime = typeof record.mime === "string" ? record.mime : "";
  let body = record.body;
  let note: string | undefined;

  const bytes = bytesOf(body);
  if (bytes) {
    if (TEXT_MIME.test(mime) || !BINARY_MIME.test(mime)) {
      body = new TextDecoder().decode(bytes);
    } else {
      body = Buffer.from(bytes).toString("base64");
      note = `${mime} body of ${bytes.length} bytes, base64-encoded`;
    }
  }

  if (typeof body === "string" && body.length > OUTPUT_BODY_LIMIT) {
    const total = body.length;
    body = body.slice(0, OUTPUT_BODY_LIMIT);
    note = `${note ? note + "; " : ""}truncated to ${OUTPUT_BODY_LIMIT} of ${total} characters — use export_notebook_html for the full output`;
  }

  return note ? { ...record, body, body_note: note } : { ...record, body };
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
