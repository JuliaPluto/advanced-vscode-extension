/**
 * The Pluto side of a VSCode markdown cell: its text inside a Julia
 * `md"""…"""` string. `decodeMarkdown(encodeMarkdown(text, wrapper)).text`
 * is `text` for every text and wrapper.
 */

export const MARKDOWN_MARKER = "#VSCODE-MARKDOWN";

/** Cell metadata key holding the wrapper a markdown cell was read with. */
export const MARKDOWN_WRAPPER_KEY = "pluto_markdown_wrapper";

/** The code around the markdown text: everything before it, and after it. */
export interface MarkdownWrapper {
  open: string;
  close: string;
}

export const DEFAULT_MARKDOWN_WRAPPER: MarkdownWrapper = {
  open: `${MARKDOWN_MARKER}\nmd"""\n`,
  close: `\n"""`,
};

export interface DecodedMarkdown {
  text: string;
  wrapper: MarkdownWrapper;
}

const TRIPLE_QUOTED =
  /^(\s*(?:#VSCODE-MARKDOWN\s*)?md"""\n?)([\s\S]*?)(\n?"""\s*)$/;
const SINGLE_QUOTED = /^(\s*(?:#VSCODE-MARKDOWN\s*)?md")([^"\n]*)("\s*)$/;
const MARKER_PREFIX = /^\s*#VSCODE-MARKDOWN/;

/**
 * Splits cell code into markdown text and its wrapper. A cell without the
 * marker is markdown only when its string has no `$`, since Julia
 * interpolates there and the cell needs to run as code.
 */
export function decodeMarkdown(code: string): DecodedMarkdown | undefined {
  const match = TRIPLE_QUOTED.exec(code) ?? SINGLE_QUOTED.exec(code);
  if (!match) {
    return undefined;
  }
  const [, open, text, close] = match;
  if (!MARKER_PREFIX.test(open) && text.includes("$")) {
    return undefined;
  }
  return { text, wrapper: { open, close } };
}

/**
 * Wraps markdown text as Pluto cell code, in the given wrapper when it
 * decodes back to the same text, otherwise in the default one.
 */
export function encodeMarkdown(text: string, wrapper?: unknown): string {
  if (isMarkdownWrapper(wrapper)) {
    const code = wrapper.open + text + wrapper.close;
    if (decodeMarkdown(code)?.text === text) {
      return code;
    }
  }
  return DEFAULT_MARKDOWN_WRAPPER.open + text + DEFAULT_MARKDOWN_WRAPPER.close;
}

export function isMarkdownCell(code: string): boolean {
  return decodeMarkdown(code) !== undefined;
}

/** The text a markdown cell shows for code received from Pluto. */
export function markdownTextFromCode(code: string): string {
  return decodeMarkdown(code)?.text ?? code;
}

function isMarkdownWrapper(value: unknown): value is MarkdownWrapper {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MarkdownWrapper).open === "string" &&
    typeof (value as MarkdownWrapper).close === "string"
  );
}
