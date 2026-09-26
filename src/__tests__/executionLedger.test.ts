import type { CellResultData } from "@plutojl/rainbow";
import { ExecutionLedger, type CellExecution } from "../executionLedger.ts";

class FakeExecution implements CellExecution<string> {
  started: number[] = [];
  outputs: string[][] = [];
  ended: Array<{ success: boolean | undefined; endTime?: number }> = [];
  rejectOutput = false;

  constructor(readonly cell: string) {}

  start(startTime?: number): void {
    this.started.push(startTime ?? -1);
  }

  replaceOutput(out: string[]): Promise<void> | void {
    if (this.ended.length > 0) {
      throw new Error("execution already resolved");
    }
    if (this.rejectOutput) {
      return Promise.reject(new Error("cell disposed"));
    }
    this.outputs.push(out);
  }

  end(success: boolean | undefined, endTime?: number): void {
    if (this.ended.length > 0) {
      throw new Error("execution already resolved");
    }
    this.ended.push({ success, endTime });
  }
}

function result(
  stamp: number | undefined,
  extra: Partial<CellResultData> = {}
): CellResultData {
  return {
    queued: false,
    running: false,
    errored: false,
    runtime: 2_000_000,
    output: { body: `out-${stamp}`, last_run_timestamp: stamp },
    ...extra,
  } as unknown as CellResultData;
}

function setup() {
  const created: FakeExecution[] = [];
  const settled: Array<[string, string]> = [];
  const logs: string[] = [];
  const ledger = new ExecutionLedger<string, string, FakeExecution>({
    createExecution: (cell) => {
      const execution = new FakeExecution(cell);
      created.push(execution);
      return execution;
    },
    formatOutput: (state) => String(state.output?.body),
    onSettled: (path, cellId) => settled.push([path, cellId]),
    log: (message) => logs.push(message),
    now: () => 1000,
  });
  return { ledger, created, settled, logs };
}

describe("ExecutionLedger", () => {
  it("reuses the live execution for a cell", () => {
    const { ledger, created } = setup();
    const first = ledger.begin("/a.jl", "c1", "cell");
    const second = ledger.begin("/a.jl", "c1", "cell");
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
    expect(first.started).toEqual([1000]);
  });

  it("emits settled on the ordinary begin → render → finish path", () => {
    const { ledger, created, settled } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    expect(ledger.render("/a.jl", "c1", result(undefined))).toBe(true);
    ledger.finish("/a.jl", "c1", result(7));

    const [execution] = created;
    expect(execution.outputs.at(-1)).toEqual(["out-7"]);
    expect(execution.ended).toEqual([{ success: true, endTime: 1000 }]);
    expect(settled).toEqual([["/a.jl", "c1"]]);
    expect(ledger.isActive("/a.jl", "c1")).toBe(false);
    expect(ledger.hasActive("/a.jl")).toBe(false);
  });

  it("ends an errored result as failed", () => {
    const { ledger, created } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    ledger.finish("/a.jl", "c1", result(7, { errored: true }));
    expect(created[0].ended[0].success).toBe(false);
  });

  it("honours an explicit end time", () => {
    const { ledger, created } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    ledger.finish("/a.jl", "c1", result(7), 1234);
    expect(created[0].ended[0].endTime).toBe(1234);
  });

  it("settles an execution that was already resolved elsewhere", () => {
    const { ledger, created, settled } = setup();
    ledger.begin("/a.jl", "c1", "cell").end(true);
    expect(() => ledger.finish("/a.jl", "c1", result(7))).not.toThrow();
    expect(created[0].ended).toHaveLength(1);
    expect(ledger.isActive("/a.jl", "c1")).toBe(false);
    expect(settled).toEqual([["/a.jl", "c1"]]);
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(true);
  });

  it("fails a live execution bound to a stale cell object and starts anew", () => {
    const { ledger, created, settled } = setup();
    const stale = ledger.begin("/a.jl", "c1", "old-cell");
    const fresh = ledger.begin("/a.jl", "c1", "new-cell");

    expect(fresh).not.toBe(stale);
    expect(fresh.cell).toBe("new-cell");
    expect(stale.ended[0].success).toBe(false);
    expect(settled).toEqual([["/a.jl", "c1"]]);
    expect(created).toHaveLength(2);
  });

  it("fails a replaced cell's execution only while bound to that cell object", () => {
    const { ledger, created } = setup();
    ledger.begin("/a.jl", "c1", "old-cell");

    ledger.fail("/a.jl", "c1", { cell: "other-cell" });
    expect(ledger.isActive("/a.jl", "c1")).toBe(true);

    ledger.fail("/a.jl", "c1", { cell: "old-cell" });
    expect(created[0].ended[0].success).toBe(false);
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(true);

    ledger.materialize("/a.jl", "c1", "new-cell", result(7));
    expect(created[1].cell).toBe("new-cell");
    expect(created[1].outputs).toEqual([["out-7"]]);
  });

  it("withdraws the stamp when the final output is rejected", async () => {
    const { ledger } = setup();
    ledger.begin("/a.jl", "c1", "cell").rejectOutput = true;
    ledger.finish("/a.jl", "c1", result(7));
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(true);
  });

  it("keeps a newer stamp when an older output is rejected", async () => {
    const { ledger } = setup();
    ledger.begin("/a.jl", "c1", "cell").rejectOutput = true;
    ledger.finish("/a.jl", "c1", result(7));
    ledger.markRendered("/a.jl", "c1", result(8));
    await Promise.resolve();
    await Promise.resolve();
    expect(ledger.needsRender("/a.jl", "c1", result(8))).toBe(false);
  });

  it("logs an asynchronous replaceOutput rejection", async () => {
    const { ledger, logs } = setup();
    ledger.begin("/a.jl", "c1", "cell").rejectOutput = true;
    ledger.render("/a.jl", "c1", result(7));
    await Promise.resolve();
    expect(logs).toEqual([
      "[LEDGER] replaceOutput rejected: Error: cell disposed",
    ]);
  });

  it("leaves the previous run's drawn result mounted when a new run starts", () => {
    const { ledger, created } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    ledger.finish("/a.jl", "c1", result(7));

    ledger.begin("/a.jl", "c1", "cell");
    expect(ledger.render("/a.jl", "c1", result(7))).toBe(true);
    expect(created[1].outputs).toEqual([]);

    ledger.render("/a.jl", "c1", result(8));
    expect(created[1].outputs).toEqual([["out-8"]]);
  });

  it("draws the same body again when it carries a new stamp", () => {
    const { ledger, created } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    ledger.finish("/a.jl", "c1", result(7));

    ledger.begin("/a.jl", "c1", "cell");
    ledger.finish(
      "/a.jl",
      "c1",
      result(8, { output: { body: "out-7", last_run_timestamp: 8 } } as never)
    );
    expect(created[1].outputs).toEqual([["out-7"]]);
  });

  it("draws a result once per run however often it is rendered", () => {
    const { ledger, created } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    ledger.render("/a.jl", "c1", result(8));
    ledger.render("/a.jl", "c1", result(8));
    ledger.finish("/a.jl", "c1", result(8));
    expect(created[0].outputs).toEqual([["out-8"]]);
    expect(created[0].ended[0].success).toBe(true);
    expect(ledger.needsRender("/a.jl", "c1", result(8))).toBe(false);
  });

  it("redraws a streamed result whose output was rejected", async () => {
    const { ledger, created } = setup();
    const execution = ledger.begin("/a.jl", "c1", "cell");
    execution.rejectOutput = true;
    ledger.render("/a.jl", "c1", result(8));
    await Promise.resolve();
    await Promise.resolve();
    execution.rejectOutput = false;
    ledger.finish("/a.jl", "c1", result(8));
    expect(created[0].outputs).toEqual([["out-8"]]);
  });

  it("renders a stamp-less result into the live execution", () => {
    const { ledger, created } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    ledger.render("/a.jl", "c1", result(undefined));
    expect(created[0].outputs).toEqual([["out-undefined"]]);
  });

  it("render and finish report false with no live execution", () => {
    const { ledger } = setup();
    expect(ledger.render("/a.jl", "c1", result(7))).toBe(false);
    expect(ledger.finish("/a.jl", "c1", result(7))).toBe(false);
  });

  it("answers needsRender from activity and the last drawn stamp", () => {
    const { ledger } = setup();
    expect(ledger.needsRender("/a.jl", "c1", result(undefined))).toBe(false);
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(true);

    ledger.begin("/a.jl", "c1", "cell");
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(false);
    ledger.finish("/a.jl", "c1", result(7));
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(false);
    expect(ledger.needsRender("/a.jl", "c1", result(8))).toBe(true);

    ledger.closeNotebook("/a.jl");
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(true);
  });

  it("materializes a result as a synthetic execution of its runtime", () => {
    const { ledger, created, settled } = setup();
    ledger.materialize("/a.jl", "c1", "cell", result(7));
    const [execution] = created;
    expect(execution.started).toEqual([998]);
    expect(execution.outputs).toEqual([["out-7"]]);
    expect(execution.ended).toEqual([{ success: true, endTime: 1000 }]);
    expect(settled).toEqual([["/a.jl", "c1"]]);
    expect(ledger.isActive("/a.jl", "c1")).toBe(false);
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(false);
  });

  it("markRendered suppresses a redraw of the same result", () => {
    const { ledger } = setup();
    ledger.markRendered("/a.jl", "c1", result(7));
    expect(ledger.needsRender("/a.jl", "c1", result(7))).toBe(false);
  });

  it("fails a cell with an output, sparing a different live execution under `only`", () => {
    const { ledger, created, settled } = setup();
    const stale = new FakeExecution("cell");
    ledger.begin("/a.jl", "c1", "cell");

    ledger.fail("/a.jl", "c1", { output: "boom", only: stale });
    expect(ledger.isActive("/a.jl", "c1")).toBe(true);
    expect(settled).toEqual([]);

    ledger.fail("/a.jl", "c1", { output: "boom", only: created[0] });
    expect(created[0].outputs).toEqual([["boom"]]);
    expect(created[0].ended[0].success).toBe(false);
    expect(settled).toEqual([["/a.jl", "c1"]]);
  });

  it("fails one notebook without touching another holding the same cell id", () => {
    const { ledger, created, settled } = setup();
    ledger.begin("/a.jl", "c1", "a-cell");
    ledger.begin("/copy.jl", "c1", "copy-cell");
    expect(created).toHaveLength(2);

    ledger.failNotebook("/a.jl");
    expect(created[0].ended[0].success).toBe(false);
    expect(created[1].ended).toEqual([]);
    expect(ledger.isActive("/copy.jl", "c1")).toBe(true);
    expect(settled).toEqual([["/a.jl", "c1"]]);
  });

  it("does not strand state under a path whose document closed", () => {
    const { ledger, created } = setup();
    ledger.begin("/old.jl", "c1", "cell");
    ledger.materialize("/old.jl", "c2", "cell", result(7));

    ledger.closeNotebook("/old.jl");
    expect(created[0].ended[0].success).toBe(false);
    expect(ledger.hasActive("/old.jl")).toBe(false);
    expect(ledger.needsRender("/old.jl", "c2", result(7))).toBe(true);

    const reopened = ledger.begin("/new.jl", "c1", "cell");
    expect(reopened).not.toBe(created[0]);
    expect(ledger.needsRender("/new.jl", "c2", result(7))).toBe(true);
  });

  it("failAll ends every notebook's executions and announces each", () => {
    const { ledger, created, settled } = setup();
    ledger.begin("/a.jl", "c1", "cell");
    ledger.begin("/a.jl", "c2", "cell");
    ledger.begin("/b.jl", "c1", "cell");

    ledger.failAll();
    expect(created.every((e) => e.ended[0]?.success === false)).toBe(true);
    expect(settled).toHaveLength(3);
    expect(ledger.hasActive("/a.jl")).toBe(false);
    expect(ledger.hasActive("/b.jl")).toBe(false);
  });
});
