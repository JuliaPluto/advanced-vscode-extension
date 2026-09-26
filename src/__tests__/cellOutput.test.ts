import type { CellResultData } from "@plutojl/rainbow";
import { rendererCellState } from "../cellOutput.ts";

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
