/**
 * What a Pluto cell output is, independent of where it is shown. Pure and
 * import-free: the extension, the CLI bundle and the notebook renderer all
 * load it.
 */

/** The JavaScript shape of `output.body`. */
export type BodyShape = "text" | "bytes" | "structured" | "empty";

export type OutputFamily =
  /** Characters: text/*, JSON, JavaScript, XML. */
  | "text"
  | "html"
  | "image"
  /** application/vnd.pluto.*+object: tree, table, stacktrace, parseerror, divelement. */
  | "pluto"
  | "none"
  | "other";

export interface OutputKind {
  /** The mime to render with; a Pluto object mime whose body lacks its shape reads as text/plain. */
  mime: string;
  family: OutputFamily;
  body: BodyShape;
  /** The body is characters, or bytes that decode to characters. */
  textual: boolean;
  /** Image bytes that must never be decoded as text. */
  raster: boolean;
  /** Bytes for byte bodies, characters for text, JSON length for structured bodies. */
  size: number;
  /** @plutojl/rainbow's OutputBody has a view for `mime`. */
  renderable: boolean;
}

const RASTER_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
  "image/webp",
]);

const RENDERABLE_MIMES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/gif",
  "image/bmp",
  "image/svg+xml",
  "text/html",
  "text/plain",
  "application/vnd.pluto.tree+object",
  "application/vnd.pluto.table+object",
  "application/vnd.pluto.parseerror+object",
  "application/vnd.pluto.stacktrace+object",
  "application/vnd.pluto.divelement+object",
]);

const TEXTUAL_MIME =
  /^(text\/|image\/svg\+xml$|application\/(json|javascript|xml)$|[^;]+\+(json|xml)$)/;
const PLUTO_OBJECT_MIME = /^application\/vnd\.pluto\.[a-z]+\+object$/;

/** Key of the JSON-safe stand-in for a byte body; see toTransport. */
const TRANSPORT_KEY = "$bytes";

interface OutputRecord {
  mime?: unknown;
  body?: unknown;
}

export function isRasterMime(mime: string): boolean {
  return RASTER_MIMES.has(mime);
}

function asRecord(output: unknown): OutputRecord | undefined {
  return output !== null && typeof output === "object"
    ? (output as OutputRecord)
    : undefined;
}

function bytesOf(body: unknown): Uint8Array | undefined {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return undefined;
}

type TransportBody = { [TRANSPORT_KEY]: string };

function isTransportBody(body: unknown): body is TransportBody {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>)[TRANSPORT_KEY] === "string"
  );
}

function shapeOf(body: unknown): BodyShape {
  if (body === undefined || body === null) return "empty";
  if (typeof body === "string") return "text";
  if (bytesOf(body) || isTransportBody(body)) return "bytes";
  return "structured";
}

function effectiveMime(mime: string, body: unknown): string {
  const hasKey = (key: string) =>
    body !== null && typeof body === "object" && key in body;
  if (mime === "application/vnd.pluto.stacktrace+object") {
    return hasKey("stacktrace") ? mime : "text/plain";
  }
  if (mime === "application/vnd.pluto.tree+object") {
    return hasKey("type") ? mime : "text/plain";
  }
  return mime;
}

function familyOf(mime: string): OutputFamily {
  if (mime === "") return "none";
  if (mime === "text/html") return "html";
  if (mime.startsWith("image/")) return "image";
  if (PLUTO_OBJECT_MIME.test(mime)) return "pluto";
  if (TEXTUAL_MIME.test(mime)) return "text";
  return "other";
}

export function classifyOutput(output: unknown): OutputKind {
  const record = asRecord(output);
  const body = record?.body;
  const mime = effectiveMime(
    typeof record?.mime === "string" ? record.mime : "",
    body
  );
  const shape = shapeOf(body);
  const raster = isRasterMime(mime);
  return {
    mime,
    family: familyOf(mime),
    body: shape,
    textual: shape === "text" || (!raster && TEXTUAL_MIME.test(mime)),
    raster,
    size: sizeOf(body, shape),
    renderable: RENDERABLE_MIMES.has(mime),
  };
}

function sizeOf(body: unknown, shape: BodyShape): number {
  switch (shape) {
    case "text":
      return (body as string).length;
    case "bytes":
      return bytesOf(body)?.length ?? base64Length(body as TransportBody);
    case "structured":
      return JSON.stringify(body).length;
    case "empty":
      return 0;
  }
}

const decoded = new WeakMap<object, string>();

function decodeText(body: object, bytes: Uint8Array): string {
  let text = decoded.get(body);
  if (text === undefined) {
    text = new TextDecoder().decode(bytes);
    decoded.set(body, text);
  }
  return text;
}

function bodyBytes(body: unknown): Uint8Array | undefined {
  return (
    bytesOf(body) ??
    (isTransportBody(body) ? fromBase64(body[TRANSPORT_KEY]) : undefined)
  );
}

/**
 * The body as characters: text as is, textual bytes decoded, structured
 * bodies as JSON. Undefined for empty bodies and for bytes that are not text.
 */
export function outputText(output: unknown): string | undefined {
  const record = asRecord(output);
  const body = record?.body;
  const kind = classifyOutput(output);
  switch (kind.body) {
    case "text":
      return body as string;
    case "bytes":
      return kind.textual
        ? decodeText(body as object, bodyBytes(body)!)
        : undefined;
    case "structured":
      return JSON.stringify(body);
    case "empty":
      return undefined;
  }
}

/** The body as bytes: bytes as is, text UTF-8 encoded, structured bodies as JSON. */
export function outputBytes(output: unknown): Uint8Array | undefined {
  const body = asRecord(output)?.body;
  const bytes = bodyBytes(body);
  if (bytes) return bytes;
  const text = outputText(output);
  return text === undefined ? undefined : new TextEncoder().encode(text);
}

/**
 * A copy of the output whose body survives JSON: textual bytes become a
 * string, and any other bytes, including bytes nested in a structured body,
 * a `{ $bytes: <base64> }` stand-in. The output passed in is never changed.
 */
export function toTransport<T>(output: T): T {
  const record = asRecord(output);
  if (!record) return output;
  const bytes = bytesOf(record.body);
  const body =
    bytes && classifyOutput(record).textual
      ? decodeText(record.body as object, bytes)
      : mapBytes(record.body, (b) => ({ [TRANSPORT_KEY]: toBase64(b) }));
  return body === record.body ? output : ({ ...record, body } as T);
}

/** Undoes toTransport's byte stand-ins; other outputs come back unchanged. */
export function fromTransport<T>(output: T): T {
  const record = asRecord(output);
  if (!record) return output;
  const body = mapBytes(record.body, (b) => b);
  return body === record.body ? output : ({ ...record, body } as T);
}

/**
 * Rebuilds `value` with every byte array or byte stand-in passed through
 * `convert`; returns `value` itself when it holds neither.
 */
function mapBytes(
  value: unknown,
  convert: (bytes: Uint8Array) => unknown
): unknown {
  const bytes = bytesOf(value);
  if (bytes) return convert(bytes);
  if (isTransportBody(value)) return convert(fromBase64(value[TRANSPORT_KEY]));
  if (value === null || typeof value !== "object") return value;
  let changed = false;
  const entries = Object.entries(value).map(([key, item]) => {
    const next: unknown = mapBytes(item, convert);
    changed ||= next !== item;
    return [key, next] as const;
  });
  if (!changed) return value;
  if (Array.isArray(value)) return entries.map(([, item]) => item);
  return Object.fromEntries(entries);
}

function base64Length(body: TransportBody): number {
  const base64 = body[TRANSPORT_KEY];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
