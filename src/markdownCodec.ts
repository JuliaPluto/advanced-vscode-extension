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

/** Splits the code of a markdown cell into its text and wrapper. */
export function decodeMarkdown(code: string): DecodedMarkdown | undefined {
  const match = TRIPLE_QUOTED.exec(code) ?? SINGLE_QUOTED.exec(code);
  if (!match) {
    return undefined;
  }
  const [, open, text, close] = match;
  return { text, wrapper: { open, close } };
}

/**
 * Decodes code that should open as a markdown cell. Without the marker, the
 * md string must be plain prose: `$` makes Julia interpolate, and a `"""`
 * inside means more than one string.
 */
export function decodeMarkdownCell(code: string): DecodedMarkdown | undefined {
  const markdown = decodeMarkdown(code);
  if (
    markdown &&
    !MARKER_PREFIX.test(markdown.wrapper.open) &&
    /\$|"""/.test(markdown.text)
  ) {
    return undefined;
  }
  return markdown;
}

/**
 * Wraps markdown text as Pluto cell code, in the given wrapper when the
 * result opens as the same markdown cell, otherwise in the default one.
 */
export function encodeMarkdown(text: string, wrapper?: unknown): string {
  if (isMarkdownWrapper(wrapper) && !endsInEscape(text, wrapper)) {
    const code = wrapper.open + text + wrapper.close;
    if (decodeMarkdownCell(code)?.text === text) {
      return code;
    }
  }
  return DEFAULT_MARKDOWN_WRAPPER.open + text + DEFAULT_MARKDOWN_WRAPPER.close;
}

export function isMarkdownCell(code: string): boolean {
  return decodeMarkdownCell(code) !== undefined;
}

function endsInEscape(text: string, wrapper: MarkdownWrapper): boolean {
  return text.endsWith("\\") && wrapper.close.startsWith('"');
}

function isMarkdownWrapper(value: unknown): value is MarkdownWrapper {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MarkdownWrapper).open === "string" &&
    typeof (value as MarkdownWrapper).close === "string"
  );
}
