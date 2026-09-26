import { classifyOutput, outputText } from "./outputKind.ts";

/** How the Pluto terminal shows a cell output: in a webview, or as text lines. */
export type TerminalPresentation =
  { kind: "webview" } | { kind: "text"; label?: string; text: string };

interface StackFrame {
  call?: string;
  file?: string;
  line?: number;
  from_c?: boolean;
}

/** Undefined when the output has nothing to show. */
export function terminalPresentation(
  output: unknown,
  canOpenWebview: boolean
): TerminalPresentation | undefined {
  const kind = classifyOutput(output);
  if (kind.family === "none" || kind.body === "empty") {
    return undefined;
  }
  if (
    canOpenWebview &&
    kind.renderable &&
    (kind.family === "image" || kind.family === "html")
  ) {
    return { kind: "webview" };
  }

  const body = (output as { body: unknown }).body;
  if (kind.mime === "application/vnd.pluto.stacktrace+object") {
    return { kind: "text", label: "Error", text: stacktraceText(body) };
  }
  const notShown = (label: string): TerminalPresentation => ({
    kind: "text",
    label: `${label}, ${sizeText(kind.size, kind.body)}`,
    text: "(not shown in the terminal)",
  });
  if (kind.family === "image") {
    return notShown(`Image: ${kind.mime}`);
  }
  if (kind.family === "html") {
    return {
      kind: "text",
      label: "HTML Output",
      text: truncated(htmlAsText(outputText(output) ?? "")),
    };
  }
  if (kind.body === "structured") {
    return {
      kind: "text",
      label: `Output: ${kind.mime}`,
      text: truncated(JSON.stringify(body, bytesAsSize, 2)),
    };
  }
  const text = kind.mimeTextual ? outputText(output) : undefined;
  if (text === undefined) {
    return notShown(`Output: ${kind.mime}`);
  }
  if (kind.mime === "text/plain") {
    return { kind: "text", text: truncated(text) };
  }
  return { kind: "text", label: `Output: ${kind.mime}`, text: truncated(text) };
}

/** Longest text printed for one output. */
export const TERMINAL_TEXT_LIMIT = 20_000;

function truncated(text: string): string {
  if (text.length <= TERMINAL_TEXT_LIMIT) return text;
  const more = text.length - TERMINAL_TEXT_LIMIT;
  return `${text.slice(0, TERMINAL_TEXT_LIMIT)}\n… ${more} more chars`;
}

function bytesAsSize(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return `<${sizeText(value.byteLength, "bytes")}>`;
  }
  return value;
}

function sizeText(size: number, shape: string): string {
  if (shape === "text") return `${size} chars`;
  if (size < 1000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1000).toFixed(1)} kB`;
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

function stacktraceText(body: unknown): string {
  const { msg, stacktrace } = body as {
    msg?: unknown;
    stacktrace?: StackFrame[];
  };
  const frames = (Array.isArray(stacktrace) ? stacktrace : [])
    .filter((frame) => !frame.from_c)
    .map(
      (frame) =>
        `  ${frame.call ?? "?"} @ ${frame.file ?? "?"}:${frame.line ?? "?"}`
    );
  return [String(msg ?? ""), ...frames].join("\n");
}

function htmlAsText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
