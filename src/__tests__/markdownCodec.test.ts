import {
  decodeMarkdown,
  DEFAULT_MARKDOWN_WRAPPER,
  encodeMarkdown,
  isMarkdownCell,
  markdownTextFromCode,
} from "../markdownCodec.ts";

const texts = [
  "# Title",
  "",
  "line one\nline two",
  "\nleading blank line",
  "trailing newline\n",
  "\n\nsurrounded\n\n",
  "has $(x) interpolation",
  'contains " a quote',
  "   indented",
];

const historicalForms = {
  "marker, fences on their own lines": `#VSCODE-MARKDOWN\nmd"""\n# Title\n"""`,
  "marker, text against the fences": `#VSCODE-MARKDOWN\nmd"""# Title"""`,
  "bare, fences on their own lines": `md"""\n# Title\n"""`,
  "bare, text against the fences": `md"""# Title"""`,
  "bare, single quotes": `md"# Title"`,
};

describe("markdown codec", () => {
  it.each(texts)("decode(encode(%j)) is the text", (text) => {
    expect(decodeMarkdown(encodeMarkdown(text))?.text).toBe(text);
  });

  it.each(Object.entries(historicalForms))(
    "decodes the %s form to the bare text",
    (_, code) => {
      expect(decodeMarkdown(code)?.text).toBe("# Title");
    }
  );

  it.each(Object.entries(historicalForms))(
    "re-encodes the %s form byte for byte",
    (_, code) => {
      const decoded = decodeMarkdown(code)!;
      expect(encodeMarkdown(decoded.text, decoded.wrapper)).toBe(code);
    }
  );

  it.each(Object.entries(historicalForms))(
    "round-trips any text through the wrapper of the %s form",
    (_, code) => {
      const { wrapper } = decodeMarkdown(code)!;
      for (const text of texts) {
        expect(decodeMarkdown(encodeMarkdown(text, wrapper))?.text).toBe(text);
      }
    }
  );

  it("writes new cells with the marker and the fences on their own lines", () => {
    expect(encodeMarkdown("# Title")).toBe(
      `#VSCODE-MARKDOWN\nmd"""\n# Title\n"""`
    );
    expect(encodeMarkdown("# Title", undefined)).toBe(
      encodeMarkdown("# Title", DEFAULT_MARKDOWN_WRAPPER)
    );
  });

  it("falls back to the default wrapper when the given one cannot hold the text", () => {
    const { wrapper } = decodeMarkdown(`md"# Title"`)!;
    expect(encodeMarkdown("two\nlines", wrapper)).toBe(
      encodeMarkdown("two\nlines")
    );
    const bare = decodeMarkdown(`md"""\n# Title\n"""`)!.wrapper;
    expect(encodeMarkdown("$(x)", bare)).toBe(encodeMarkdown("$(x)"));
  });

  it("keeps interpolating md strings without the marker as code", () => {
    expect(isMarkdownCell(`md"""\nx is $(x)\n"""`)).toBe(false);
    expect(isMarkdownCell(`md"$(@bind x Slider(1:10))"`)).toBe(false);
    expect(isMarkdownCell(`#VSCODE-MARKDOWN\nmd"""\nx is $(x)\n"""`)).toBe(
      true
    );
  });

  it("does not treat code around an md string as markdown", () => {
    expect(isMarkdownCell(`md"""# Title""" |> display`)).toBe(false);
    expect(isMarkdownCell(`x = md"""# Title"""`)).toBe(false);
    expect(isMarkdownCell(`#VSCODE-MARKDOWN\nx = 1`)).toBe(false);
  });

  describe("echo of a local edit", () => {
    it.each(texts)(
      "reads the code sent for %j back as the same text",
      (text) => {
        expect(markdownTextFromCode(encodeMarkdown(text))).toBe(text);
      }
    );

    it("reads code that is not markdown as itself", () => {
      expect(markdownTextFromCode("x = 1")).toBe("x = 1");
    });
  });
});
