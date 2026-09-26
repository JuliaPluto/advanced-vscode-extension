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
  if (kind.family === "image") {
    return {
      kind: "text",
      label: `Image: ${kind.mime}`,
      text: `(${kind.size} bytes, not shown in the terminal)`,
    };
  }
  if (kind.family === "html") {
    return {
      kind: "text",
      label: "HTML Output",
      text: htmlAsText(outputText(output) ?? ""),
    };
  }
  if (kind.body === "structured") {
    return {
      kind: "text",
      label: `Output: ${kind.mime}`,
      text: JSON.stringify(body, null, 2),
    };
  }
  const text = kind.mimeTextual ? outputText(output) : undefined;
  if (text === undefined) {
    return {
      kind: "text",
      label: `Output: ${kind.mime}`,
      text: `(${kind.size} bytes, not shown in the terminal)`,
    };
  }
  if (kind.mime === "text/plain") {
    return { kind: "text", text };
  }
  return { kind: "text", label: `Output: ${kind.mime}`, text };
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
