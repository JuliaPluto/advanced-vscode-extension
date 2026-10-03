import { jest } from "@jest/globals";
import {
  classifyOutput,
  fromTransport,
  outputBytes,
  outputText,
  toTransport,
  UNKNOWN_MIME,
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
    "image/jpeg",
    png,
    { family: "image", raster: true, textual: false, renderable: true },
  ],
  [
    "image/gif",
    png,
    { family: "image", raster: true, textual: false, renderable: true },
  ],
  [
    "image/png",
    png.buffer,
    { body: "bytes", raster: true, textual: false, size: 9 },
  ],
  [
    "image/png",
    "\u0089PNG",
    { body: "text", raster: true, mimeTextual: false, textual: true },
  ],
  [
    "image/tiff",
    png,
    {
      family: "image",
      raster: false,
      mimeTextual: false,
      textual: false,
      renderable: false,
    },
  ],
  [
    "application/vnd.pluto.parseerror+object",
    { msg: "x" },
    { family: "pluto", body: "structured", renderable: true },
  ],
  [
    "application/vnd.pluto.divelement+object",
    { children: [] },
    { family: "pluto", renderable: true },
  ],
  [
    "application/atom+xml",
    utf8("<feed/>"),
    { family: "text", mimeTextual: true, textual: true, renderable: false },
  ],
  [
    "application/x-foo",
    "abc",
    { family: "other", body: "text", mimeTextual: false, textual: true },
  ],
  [
    "application/x-foo",
    png,
    { family: "other", body: "bytes", mimeTextual: false, textual: false },
  ],
  [
    "application/pdf",
    "%PDF-1.4",
    { family: "other", mimeTextual: false, textual: true },
  ],
];

describe("classifyOutput", () => {
  it.each(rows)("%s (%p)", (mime, body, expected) => {
    expect(classifyOutput({ mime, body })).toMatchObject({ mime, ...expected });
  });

  it("reports a missing mime as unknown", () => {
    for (const mime of [undefined, "", 42]) {
      expect(classifyOutput({ mime, body: "x" })).toMatchObject({
        mime: UNKNOWN_MIME,
        family: "none",
        mimeTextual: false,
        renderable: false,
      });
    }
    expect(classifyOutput({ body: undefined })).toMatchObject({
      mime: UNKNOWN_MIME,
      body: "empty",
      size: 0,
    });
  });

  it("drops mime parameters", () => {
    expect(
      classifyOutput({
        mime: "application/json; charset=utf-8",
        body: utf8("{}"),
      })
    ).toMatchObject({
      mime: "application/json",
      mimeTextual: true,
      textual: true,
    });
  });

  it("reads a $bytes body only when it is valid base64", () => {
    expect(
      classifyOutput({ mime: "image/png", body: { $bytes: "iVBO" } }).body
    ).toBe("bytes");
    expect(
      classifyOutput({ mime: "image/png", body: { $bytes: "not base64!" } })
        .body
    ).toBe("structured");
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
        mime: UNKNOWN_MIME,
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
    const decode = jest.spyOn(TextDecoder.prototype, "decode");
    try {
      const buffer = utf8("<svg/><svg/>").buffer;
      const output = {
        mime: "image/svg+xml",
        body: new Uint8Array(buffer, 0, 6),
      };
      const otherView = {
        mime: "image/svg+xml",
        body: new Uint8Array(buffer, 6, 6),
      };
      expect(outputText(output)).toBe("<svg/>");
      expect(outputText(output)).toBe("<svg/>");
      expect(outputText({ ...output })).toBe("<svg/>");
      expect(decode).toHaveBeenCalledTimes(1);
      expect(outputText(otherView)).toBe("<svg/>");
      expect(decode).toHaveBeenCalledTimes(2);
      expect(output.body).toBeInstanceOf(Uint8Array);
    } finally {
      decode.mockRestore();
    }
  });

  it("decodes a textual $bytes body once", () => {
    const decode = jest.spyOn(TextDecoder.prototype, "decode");
    try {
      const output = {
        mime: "image/svg+xml",
        body: { $bytes: btoa("<svg/>") },
      };
      expect(outputText(output)).toBe("<svg/>");
      expect(outputText(output)).toBe("<svg/>");
      expect(decode).toHaveBeenCalledTimes(1);
    } finally {
      decode.mockRestore();
    }
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

  it("carries only the byte range of a typed-array view", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4]);
    const output = { mime: "image/png", body: backing.subarray(1, 4) };
    const back = fromTransport(throughJson(toTransport(output)));
    expect(Array.from(back.body as Uint8Array)).toEqual([1, 2, 3]);
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

  it("carries a 5 MB image", () => {
    const big = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 253);
    const sent = throughJson(toTransport({ mime: "image/png", body: big }));
    expect(classifyOutput(sent)).toMatchObject({
      body: "bytes",
      size: big.length,
    });
    expect(fromTransport(sent).body).toEqual(big);
  });

  it("decodes the same stand-in to the same array", () => {
    const sent = throughJson(toTransport({ mime: "image/png", body: png }));
    expect(fromTransport(sent).body).toBe(
      fromTransport(throughJson(sent)).body
    );
  });

  it("encodes a body object once", () => {
    const output = { mime: "image/png", body: png };
    expect(toTransport(output).body).toBe(toTransport({ ...output }).body);
  });

  it("keeps recent decodes within a byte budget", () => {
    const big = (fill: number) =>
      throughJson(
        toTransport({
          mime: "image/png",
          body: new Uint8Array(12 * 1024 * 1024).fill(fill),
        })
      );
    const first = big(1);
    const firstBytes = fromTransport(first).body;
    expect(fromTransport(first).body).toBe(firstBytes);
    fromTransport(big(2));
    fromTransport(big(3));
    expect(fromTransport(first).body).not.toBe(firstBytes);
  });

  it("round-trips an image larger than one encoding chunk", () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    const back = fromTransport(
      throughJson(toTransport({ mime: "image/png", body: big }))
    );
    expect(back.body).toEqual(big);
  });
});
