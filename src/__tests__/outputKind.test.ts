import {
  classifyOutput,
  fromTransport,
  outputBytes,
  outputText,
  toTransport,
  type OutputKind,
} from "../outputKind.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff,
]);

type Row = [string, unknown, Partial<OutputKind>];

const rows: Row[] = [
  [
    "text/plain",
    "42",
    { family: "text", body: "text", textual: true, renderable: true, size: 2 },
  ],
  [
    "text/plain",
    utf8("42"),
    { family: "text", body: "bytes", textual: true, size: 2 },
  ],
  [
    "text/html",
    "<b>x</b>",
    { family: "html", textual: true, renderable: true },
  ],
  [
    "image/svg+xml",
    utf8("<svg/>"),
    {
      family: "image",
      body: "bytes",
      textual: true,
      raster: false,
      renderable: true,
      size: 6,
    },
  ],
  [
    "image/png",
    png,
    {
      family: "image",
      body: "bytes",
      textual: false,
      raster: true,
      renderable: true,
      size: 9,
    },
  ],
  ["image/jpg", png, { raster: true, renderable: true }],
  ["image/bmp", png, { raster: true, renderable: true }],
  ["image/webp", png, { family: "image", raster: true, renderable: false }],
  [
    "application/vnd.plotly.v1+json",
    utf8("{}"),
    { family: "text", textual: true, renderable: false },
  ],
  [
    "application/vnd.vegalite.v4+json",
    "{}",
    { family: "text", textual: true, renderable: false },
  ],
  [
    "application/json",
    "{}",
    { family: "text", textual: true, renderable: false },
  ],
  [
    "application/pdf",
    png,
    { family: "other", textual: false, raster: false, renderable: false },
  ],
  ["application/octet-stream", png, { family: "other", textual: false }],
  [
    "application/vnd.pluto.tree+object",
    { type: "Array", elements: [] },
    { family: "pluto", body: "structured", textual: false, renderable: true },
  ],
  [
    "application/vnd.pluto.table+object",
    { rows: [] },
    { family: "pluto", body: "structured", renderable: true },
  ],
  [
    "application/vnd.pluto.stacktrace+object",
    { msg: "boom", stacktrace: [] },
    { family: "pluto", renderable: true },
  ],
  [
    "",
    undefined,
    { family: "none", body: "empty", size: 0, renderable: false },
  ],
];

describe("classifyOutput", () => {
  it.each(rows)("%s (%p)", (mime, body, expected) => {
    expect(classifyOutput({ mime, body })).toMatchObject({ mime, ...expected });
  });

  it("reads a Pluto object mime whose body lacks its shape as text/plain", () => {
    expect(
      classifyOutput({
        mime: "application/vnd.pluto.stacktrace+object",
        body: "oops",
      })
    ).toMatchObject({ mime: "text/plain", family: "text", body: "text" });
    expect(
      classifyOutput({
        mime: "application/vnd.pluto.tree+object",
        body: { a: 1 },
      })
    ).toMatchObject({ mime: "text/plain", body: "structured" });
  });

  it("accepts outputs that are not objects", () => {
    for (const output of [undefined, null, 42]) {
      expect(classifyOutput(output)).toMatchObject({
        family: "none",
        body: "empty",
      });
    }
  });

  it("accepts ArrayBuffer bodies", () => {
    expect(
      classifyOutput({ mime: "image/svg+xml", body: utf8("<svg/>").buffer })
    ).toMatchObject({ body: "bytes", textual: true, size: 6 });
  });
});

describe("outputText / outputBytes", () => {
  it("decodes textual bytes and never raster bytes", () => {
    expect(outputText({ mime: "image/svg+xml", body: utf8("<svg/>") })).toBe(
      "<svg/>"
    );
    expect(outputText({ mime: "image/png", body: png })).toBeUndefined();
    expect(outputBytes({ mime: "image/png", body: png })).toBe(png);
  });

  it("serializes structured bodies and encodes text", () => {
    const tree = {
      mime: "application/vnd.pluto.tree+object",
      body: { type: "x" },
    };
    expect(outputText(tree)).toBe('{"type":"x"}');
    expect(
      Array.from(outputBytes({ mime: "text/plain", body: "hi" })!)
    ).toEqual([104, 105]);
    expect(outputBytes({ mime: "text/plain" })).toBeUndefined();
  });

  it("decodes a body once and leaves the output untouched", () => {
    const output = { mime: "image/svg+xml", body: utf8("<svg/>") };
    const first = outputText(output);
    expect(outputText(output)).toBe(first);
    expect(output.body).toBeInstanceOf(Uint8Array);
  });
});

describe("toTransport / fromTransport", () => {
  const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  it("carries raster bytes through JSON byte for byte", () => {
    const output = { mime: "image/png", body: png, rootassignee: null };
    const back = fromTransport(throughJson(toTransport(output)));
    expect(back.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.body as Uint8Array)).toEqual(Array.from(png));
    expect(output.body).toBe(png);
  });

  it("sends textual bytes as a string", () => {
    const sent = toTransport({ mime: "image/svg+xml", body: utf8("<svg/>") });
    expect(sent.body).toBe("<svg/>");
    expect(fromTransport(sent)).toBe(sent);
  });

  it("carries bytes nested in a structured body", () => {
    const tree = {
      mime: "application/vnd.pluto.tree+object",
      body: {
        type: "Array",
        elements: [
          [1, [png, "image/png"]],
          [2, ["x", "text/plain"]],
        ],
      },
    };
    const back = fromTransport(throughJson(toTransport(tree)));
    const nested = (back.body.elements[0][1] as unknown[])[0];
    expect(nested).toBeInstanceOf(Uint8Array);
    expect(Array.from(nested as Uint8Array)).toEqual(Array.from(png));
    expect(back.body.elements[1]).toEqual([2, ["x", "text/plain"]]);
  });

  it("classifies and sizes a transported body as bytes", () => {
    expect(
      classifyOutput(toTransport({ mime: "image/png", body: png }))
    ).toMatchObject({
      body: "bytes",
      size: png.length,
    });
  });

  it("returns outputs without bytes as they are", () => {
    for (const output of [
      { mime: "text/plain", body: "x" },
      {
        mime: "application/vnd.pluto.tree+object",
        body: { type: "x", elements: [] },
      },
      undefined,
    ]) {
      expect(toTransport(output)).toBe(output);
      expect(fromTransport(output)).toBe(output);
    }
  });

  it("round-trips an image larger than one encoding chunk", () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    const back = fromTransport(
      throughJson(toTransport({ mime: "image/png", body: big }))
    );
    expect(back.body).toEqual(big);
  });
});
