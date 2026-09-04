import { newNotebookSource, presentOutput } from "../notebookOutput.ts";

describe("presentOutput", () => {
  it("decodes byte bodies of text-like mimes to strings", () => {
    const svg = "<svg>hi</svg>";
    const out = presentOutput({
      mime: "image/svg+xml",
      body: new TextEncoder().encode(svg),
    }) as { body: unknown; body_note?: string };
    expect(out.body).toBe(svg);
    expect(out.body_note).toBeUndefined();
  });

  it("base64-encodes binary bodies with a note", () => {
    const out = presentOutput({
      mime: "image/png",
      body: new Uint8Array([137, 80, 78, 71]),
    }) as { body: string; body_note: string };
    expect(out.body).toBe(Buffer.from([137, 80, 78, 71]).toString("base64"));
    expect(out.body_note).toMatch(/image\/png body of 4 bytes/);
  });

  it("truncates long bodies with a note", () => {
    const out = presentOutput({
      mime: "text/html",
      body: "x".repeat(40_000),
    }) as { body: string; body_note: string };
    expect(out.body.length).toBe(32_000);
    expect(out.body_note).toMatch(/truncated to 32000 of 40000/);
  });

  it("leaves other outputs alone", () => {
    expect(presentOutput(undefined)).toBeUndefined();
    const tree = { mime: "application/vnd.pluto.tree+object", body: { a: 1 } };
    expect(presentOutput(tree)).toEqual(tree);
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
