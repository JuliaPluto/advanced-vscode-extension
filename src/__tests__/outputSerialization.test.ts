import {
  restoreCellResult,
  serializeCellResult,
} from "../outputSerialization.ts";
import type { CellResultData } from "@plutojl/rainbow";

const cellResult = (body: unknown) =>
  ({
    cell_id: "cell-id",
    queued: false,
    running: false,
    errored: false,
    runtime: 0,
    downstream_cells_map: {},
    upstream_cells_map: {},
    precedence_heuristic: null,
    depends_on_disabled_cells: false,
    depends_on_skipped_cells: false,
    output: {
      body,
      persist_js_state: false,
      last_run_timestamp: 1,
      mime: "image/png",
      rootassignee: null,
      has_pluto_hook_features: false,
    },
    logs: [],
    published_object_keys: [""],
  }) as CellResultData;

describe("cell result binary output serialization", () => {
  it("round-trips arbitrary PNG bytes through JSON and into a Blob", async () => {
    const input = cellResult(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xc3, 0x28])
    );

    const encoded = JSON.parse(
      JSON.stringify(serializeCellResult(input))
    ) as CellResultData;
    const restored = restoreCellResult(encoded);

    expect(Array.from(restored.output.body as Uint8Array)).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xc3, 0x28,
    ]);
    const imageBytes = restored.output.body as Uint8Array;
    const imageBuffer = new ArrayBuffer(imageBytes.byteLength);
    new Uint8Array(imageBuffer).set(imageBytes);
    const image = new Blob([imageBuffer], { type: "image/png" });
    expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xc3, 0x28,
    ]);
  });

  it("does not alter text or structured output bodies", () => {
    const text = cellResult("plain output");
    const tree = cellResult({ type: "object", value: 1 });

    expect(serializeCellResult(text)).toBe(text);
    expect(restoreCellResult(text)).toBe(text);
    expect(serializeCellResult(tree)).toBe(tree);
    expect(restoreCellResult(tree)).toBe(tree);
  });

  it("preserves the byte range of typed-array views", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4]);
    const input = cellResult(backing.subarray(1, 4));
    const restored = restoreCellResult(
      JSON.parse(JSON.stringify(serializeCellResult(input))) as CellResultData
    );

    expect(Array.from(restored.output.body as Uint8Array)).toEqual([1, 2, 3]);
  });
});
