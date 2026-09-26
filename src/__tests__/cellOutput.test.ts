import type { CellResultData } from "@plutojl/rainbow";
import { formatCellOutput, rendererCellState } from "../cellOutput.ts";
import { fromTransport } from "../outputKind.ts";

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff,
]);
const pngState = {
  cell_id: "c2",
  queued: false,
  running: false,
  errored: false,
  logs: [],
  output: { body: png, mime: "image/png", last_run_timestamp: 8 },
} as unknown as CellResultData;

/** What the renderer receives: the state after a JSON round trip, decoded. */
const received = (sent: unknown) => {
  const state = JSON.parse(JSON.stringify(sent)) as CellResultData;
  return { ...state, output: fromTransport(state.output) };
};

const state = {
  cell_id: "c1",
  queued: false,
  running: true,
  errored: false,
  logs: [{ msg: "hi" }],
  output: { body: "out", mime: "text/plain", last_run_timestamp: 7 },
} as unknown as CellResultData;

describe("rendererCellState", () => {
  it("leaves output out while an execution is live", () => {
    const sent = rendererCellState(state, true);
    expect("output" in sent).toBe(false);
    expect(sent).toMatchObject({
      cell_id: "c1",
      running: true,
      logs: [{ msg: "hi" }],
    });
    expect(state.output).toBeDefined();
  });

  it("sends the full state when no execution is live", () => {
    expect(rendererCellState(state, false)).toBe(state);
  });
});

describe("byte outputs reaching the renderer", () => {
  it("keep their bytes through the output item", () => {
    const [item] = formatCellOutput(pngState).items as unknown as {
      data: string;
      mime: string;
    }[];
    expect(item.mime).toBe("x-application/pluto-output");
    const state = received(JSON.parse(item.data));
    expect(state.output.body).toEqual(png);
  });

  it("keep their bytes through a setState message", () => {
    expect(received(rendererCellState(pngState, false)).output.body).toEqual(
      png
    );
  });

  it("reach the renderer as text when they are an SVG", () => {
    const svg = {
      ...pngState,
      output: {
        ...pngState.output,
        mime: "image/svg+xml",
        body: new TextEncoder().encode("<svg/>"),
      },
    } as unknown as CellResultData;
    expect(received(rendererCellState(svg, false)).output.body).toBe("<svg/>");
  });

  it("leave the worker's state untouched", () => {
    formatCellOutput(pngState);
    rendererCellState(pngState, false);
    expect(pngState.output.body).toBe(png);
  });
});
