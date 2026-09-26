import {
  EditProvenance,
  addedCellIdentity,
  classifyStructuralChange,
  planOrderSync,
  type OrderSyncResult,
} from "../editProvenance.ts";

class ManualTimers {
  private next = 1;
  readonly pending = new Map<number, { callback: () => void; ms: number }>();

  set = (callback: () => void, ms: number): unknown => {
    const handle = this.next++;
    this.pending.set(handle, { callback, ms });
    return handle;
  };

  clear = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  delays(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }

  runAll(): void {
    const due = [...this.pending];
    this.pending.clear();
    for (const [, timer] of due) {
      timer.callback();
    }
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(applyEdit: (edit: string) => PromiseLike<boolean>) {
  const timers = new ManualTimers();
  const logs: string[] = [];
  const provenance = new EditProvenance<string>({
    applyEdit,
    log: (message) => logs.push(message),
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  return { provenance, timers, logs };
}

describe("EditProvenance edits", () => {
  it("applyRemote claims no structural change, so a user add or delete during it is handled", async () => {
    const claimed: boolean[] = [];
    const { provenance, timers } = setup(async () => {
      claimed.push(
        provenance.isOwnStructuralChange("/a.jl", ["a", undefined]),
        provenance.isOwnStructuralChange("/a.jl", ["a"])
      );
      return true;
    });
    expect(await provenance.applyRemote("stamp")).toBe(true);
    expect(claimed).toEqual([false, false]);
    expect(timers.pending.size).toBe(0);
  });

  it("replaceStructure claims only the change that leaves exactly the expected ids", async () => {
    const claimed: boolean[] = [];
    const { provenance, timers } = setup(async () => {
      claimed.push(
        provenance.isOwnStructuralChange("/a.jl", ["b", "a"]),
        // a user add, delete or move racing the edit
        provenance.isOwnStructuralChange("/a.jl", ["b", "a", undefined]),
        provenance.isOwnStructuralChange("/a.jl", ["b"]),
        provenance.isOwnStructuralChange("/a.jl", ["a", "b"]),
        provenance.isOwnStructuralChange("/other.jl", ["b", "a"])
      );
      return true;
    });

    expect(await provenance.replaceStructure("/a.jl", "edit", ["b", "a"])).toBe(
      true
    );
    expect(claimed).toEqual([true, false, false, false, false]);
    expect(provenance.isOwnStructuralChange("/a.jl", ["b", "a"])).toBe(true);

    timers.runAll();
    expect(provenance.isOwnStructuralChange("/a.jl", ["b", "a"])).toBe(false);
  });

  it("a newer replaceStructure's expectation survives the older one's release", async () => {
    const { provenance, timers } = setup(async () => true);
    await provenance.replaceStructure("/a.jl", "one", ["a"]);
    const [olderRelease] = [...timers.pending.values()];
    timers.pending.clear();
    await provenance.replaceStructure("/a.jl", "two", ["b"]);
    olderRelease.callback();
    expect(provenance.isOwnStructuralChange("/a.jl", ["b"])).toBe(true);
  });

  it("releases the expectation when the edit fails", async () => {
    const { provenance, timers } = setup(() =>
      Promise.reject(new Error("bad edit"))
    );
    await expect(
      provenance.replaceStructure("/a.jl", "edit", ["a"])
    ).rejects.toThrow("bad edit");
    timers.runAll();
    expect(provenance.isOwnStructuralChange("/a.jl", ["a"])).toBe(false);
  });
});

describe("EditProvenance.scheduleOrderSync", () => {
  it("coalesces requests made while a sync is pending", async () => {
    const { provenance, timers } = setup(async () => true);
    let runs = 0;
    const sync = async (): Promise<OrderSyncResult> => {
      runs++;
      return "applied";
    };
    provenance.scheduleOrderSync("/a.jl", sync);
    provenance.scheduleOrderSync("/a.jl", sync);
    expect(timers.delays()).toEqual([100]);

    timers.runAll();
    await flush();
    expect(runs).toBe(1);
    expect(timers.pending.size).toBe(0);
  });

  it("retries a deferred sync with capped exponential backoff, at most 60 times", async () => {
    const { provenance, timers } = setup(async () => true);
    let runs = 0;
    const sync = async (): Promise<OrderSyncResult> => {
      runs++;
      return "deferred";
    };
    provenance.scheduleOrderSync("/a.jl", sync);
    const delays: number[] = [];
    while (timers.pending.size > 0) {
      delays.push(...timers.delays());
      timers.runAll();
      await flush();
    }
    expect(runs).toBe(60);
    expect(delays.slice(0, 7)).toEqual([100, 200, 400, 800, 1600, 3200, 5000]);
    expect(delays.at(-1)).toBe(5000);
  });

  it("forget drops a pending sync", async () => {
    const { provenance, timers } = setup(async () => true);
    let runs = 0;
    provenance.scheduleOrderSync("/a.jl", async () => {
      runs++;
      return "applied";
    });
    provenance.forget("/a.jl");
    expect(timers.pending.size).toBe(0);
    timers.runAll();
    await flush();
    expect(runs).toBe(0);
  });

  it("does not reschedule a sync that was running when the notebook was forgotten", async () => {
    const { provenance, timers } = setup(async () => true);
    let release!: (result: OrderSyncResult) => void;
    provenance.scheduleOrderSync(
      "/a.jl",
      () => new Promise<OrderSyncResult>((resolve) => (release = resolve))
    );
    timers.runAll();
    provenance.forget("/a.jl");
    release("deferred");
    await flush();
    expect(timers.pending.size).toBe(0);
  });

  it("does not reschedule or accept syncs after dispose", async () => {
    const { provenance, timers } = setup(async () => true);
    let release!: (result: OrderSyncResult) => void;
    provenance.scheduleOrderSync(
      "/a.jl",
      () => new Promise<OrderSyncResult>((resolve) => (release = resolve))
    );
    timers.runAll();
    provenance.dispose();
    release("deferred");
    await flush();
    provenance.scheduleOrderSync("/b.jl", async () => "applied");
    expect(timers.pending.size).toBe(0);
  });

  it("a forgotten path accepts new syncs", async () => {
    const { provenance, timers } = setup(async () => true);
    provenance.forget("/a.jl");
    provenance.scheduleOrderSync("/a.jl", async () => "applied");
    expect(timers.pending.size).toBe(1);
  });

  it("logs a failed sync and stops", async () => {
    const { provenance, timers, logs } = setup(async () => true);
    provenance.scheduleOrderSync("/a.jl", () =>
      Promise.reject(new Error("no worker"))
    );
    timers.runAll();
    await flush();
    expect(logs).toEqual(["[CellOrderSync] Failed: no worker"]);
    expect(timers.pending.size).toBe(0);
  });
});

describe("planOrderSync", () => {
  it("defers while a local add waits for its id", () => {
    expect(planOrderSync(["a", undefined], ["a", "b"], false)).toBe("deferred");
  });

  it("is a noop when the orders match, even with an execution in flight", () => {
    expect(planOrderSync(["a", "b"], ["a", "b"], true)).toBe("noop");
  });

  it("defers a differing order while an execution is in flight", () => {
    expect(planOrderSync(["a", "b"], ["b", "a"], true)).toBe("deferred");
  });

  it("applies a differing order", () => {
    expect(planOrderSync(["a", "b"], ["b", "a"], false)).toBe("apply");
    expect(planOrderSync(["a"], ["a", "b"], false)).toBe("apply");
  });
});

describe("classifyStructuralChange", () => {
  const cell = (id?: string, tag = "") => ({ id, tag });
  const idOf = (c: { id?: string }) => c.id;

  it("treats an id in both added and removed as a move", () => {
    const movedIn = cell("m", "in");
    const movedOut = cell("m", "out");
    const fresh = cell(undefined);
    const gone = cell("g");
    const result = classifyStructuralChange(
      [movedIn, fresh],
      [movedOut, gone],
      idOf
    );
    expect(result).toEqual({
      moved: [movedIn],
      added: [fresh],
      removed: [gone],
    });
  });

  it("never pairs id-less cells as moves", () => {
    const a = cell(undefined, "a");
    const b = cell(undefined, "b");
    expect(classifyStructuralChange([a], [b], idOf)).toEqual({
      moved: [],
      added: [a],
      removed: [b],
    });
  });
});

describe("addedCellIdentity", () => {
  it("classifies an added cell by its id, Pluto's cells and the document's", () => {
    expect(addedCellIdentity(undefined, false, 0)).toBe("new");
    expect(addedCellIdentity("x", false, 1)).toBe("restore");
    expect(addedCellIdentity("x", true, 1)).toBe("echo");
    expect(addedCellIdentity("x", true, 2)).toBe("paste");
  });
});
