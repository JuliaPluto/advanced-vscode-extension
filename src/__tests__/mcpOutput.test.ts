import {
  INLINE_TEXT_LIMIT,
  INLINE_TREE_LIMIT,
  extensionFor,
  fullOutput,
  newNotebookSource,
  presentOutput,
  renderCellToPngCode,
} from "../notebookOutput.ts";

describe("presentOutput", () => {
  it("replaces image bodies with their size and a fetch hint", () => {
    const out = presentOutput({
      mime: "image/svg+xml",
      body: new TextEncoder().encode("<svg>hi</svg>"),
    }) as { body: unknown; bytes: number; body_note: string };
    expect(out.body).toBeNull();
    expect(out.bytes).toBe(13);
    expect(out.body_note).toMatch(/image\/svg\+xml output of 13 bytes/);
    expect(out.body_note).toMatch(/read_cell_output/);
  });

  it("does the same for raster images and PDFs", () => {
    for (const mime of ["image/png", "application/pdf"]) {
      const out = presentOutput({ mime, body: new Uint8Array(5) }) as {
        body: unknown;
        bytes: number;
      };
      expect(out.body).toBeNull();
      expect(out.bytes).toBe(5);
    }
  });

  it("decodes short text bodies and keeps them inline", () => {
    const out = presentOutput({
      mime: "text/plain",
      body: new TextEncoder().encode("42"),
    }) as { body: string; body_note?: string };
    expect(out.body).toBe("42");
    expect(out.body_note).toBeUndefined();
  });

  it("truncates long text with a note", () => {
    const out = presentOutput({
      mime: "text/html",
      body: "x".repeat(INLINE_TEXT_LIMIT + 100),
    }) as { body: string; body_note: string };
    expect(out.body.length).toBe(INLINE_TEXT_LIMIT);
    expect(out.body_note).toMatch(/truncated to 4000 of 4100 characters/);
  });

  it("keeps small tree objects and drops large ones", () => {
    const small = { mime: "application/vnd.pluto.tree+object", body: { a: 1 } };
    expect(presentOutput(small)).toEqual(small);
    const big = presentOutput({
      mime: "application/vnd.pluto.tree+object",
      body: { elements: Array.from({ length: 2000 }, (_, i) => [i, "x"]) },
    }) as { body: unknown; bytes: number; body_note: string };
    expect(big.body).toBeNull();
    expect(big.bytes).toBeGreaterThan(INLINE_TREE_LIMIT);
    expect(big.body_note).toMatch(/not returned inline/);
  });

  it("leaves non-objects alone", () => {
    expect(presentOutput(undefined)).toBeUndefined();
    expect(presentOutput(null)).toBeNull();
  });
});

describe("fullOutput", () => {
  it("decodes text-like byte bodies and keeps binary ones as bytes", () => {
    const svg = fullOutput({
      mime: "image/svg+xml",
      body: new TextEncoder().encode("<svg/>"),
    });
    expect(svg?.text).toBe("<svg/>");
    const png = fullOutput({ mime: "image/png", body: new Uint8Array([1, 2]) });
    expect(png?.text).toBeUndefined();
    expect(Array.from(png!.bytes)).toEqual([1, 2]);
  });

  it("serializes tree objects to JSON text", () => {
    const tree = fullOutput({
      mime: "application/vnd.pluto.tree+object",
      body: { a: 1 },
    });
    expect(tree?.text).toBe('{"a":1}');
  });

  it("returns undefined without a body", () => {
    expect(fullOutput({ mime: "text/plain" })).toBeUndefined();
    expect(fullOutput(undefined)).toBeUndefined();
  });
});

describe("extensionFor", () => {
  it("maps common mimes and falls back to bin", () => {
    expect(extensionFor("image/svg+xml")).toBe("svg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("text/html")).toBe("html");
    expect(extensionFor("application/x-unknown")).toBe("bin");
  });
});

describe("renderCellToPngCode", () => {
  it("targets the cell's stored value and escapes the path", () => {
    const code = renderCellToPngCode("abc-123", 'C:\\tmp\\"x".png');
    expect(code).toContain('Base.UUID("abc-123")');
    expect(code).toContain('MIME("image/png")');
    expect(code).toContain('"C:\\\\tmp\\\\\\"x\\".png"');
  });
});

describe("newNotebookSource", () => {
  it("produces a parseable empty notebook", () => {
    const src = newNotebookSource();
    expect(src.startsWith("### A Pluto.jl notebook ###")).toBe(true);
    expect(src).toContain("# ╔═╡ Cell order:");
    expect(src).not.toContain('md"""');
  });

  it("adds a folded markdown title cell", () => {
    const src = newNotebookSource('Hello "world"');
    const id = /# ╔═╡ ([0-9a-f-]{36})\n/.exec(src)?.[1];
    expect(id).toBeDefined();
    expect(src).toContain(`# Hello 'world'`);
    expect(src).toContain(`# ╟─${id}`);
  });
});
