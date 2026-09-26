import { jest } from "@jest/globals";
import { z } from "zod";
import type { ServerState } from "../plutoManager.js";
import {
  EXECUTION_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  content,
  execution,
  notebookTool,
  STILL_STARTING,
  reply,
  serverTool,
  tool,
  unacknowledged,
} from "../mcpTools/tool.js";
import {
  SERVER_URL,
  fakePlutoManager,
  fakeWorker,
  never,
  textOf,
} from "./helpers/fakePlutoManager.js";

describe("tool", () => {
  it("sends a string as one text block", async () => {
    const t = tool({
      name: "t",
      description: "",
      args: {},
      run: async () => "hi",
    });
    expect(await t.call({})).toEqual({
      content: [{ type: "text", text: "hi" }],
    });
  });

  it("sends an object as pretty JSON", async () => {
    const t = tool({
      name: "t",
      description: "",
      args: {},
      run: async () => ({ a: 1 }),
    });
    expect(textOf(await t.call({}))).toBe('{\n  "a": 1\n}');
  });

  it("passes content() through unwrapped", async () => {
    const blocks = [
      { type: "image" as const, data: "AA==", mimeType: "image/png" },
    ];
    const t = tool({
      name: "t",
      description: "",
      args: {},
      run: async () => content(blocks, { isError: true }),
    });
    expect(await t.call({})).toEqual({ content: blocks, isError: true });
  });

  it("turns a thrown error into an error result", async () => {
    const t = tool({
      name: "t",
      description: "",
      args: {},
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(await t.call({})).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
  });

  it("applies argument defaults and rejects bad arguments", async () => {
    const t = tool({
      name: "t",
      description: "",
      args: { n: z.number().optional().default(7) },
      run: async ({ n }) => String(n),
    });
    expect(textOf(await t.call({}))).toBe("7");
    expect((await t.call({ n: "x" })).isError).toBe(true);
  });

  describe("bounds", () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("defaults to the reply bound, answering as a stalled connection", async () => {
      const t = tool({ name: "slow", description: "", args: {}, run: never });
      const call = t.call({});
      await jest.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
      const result = await call;
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("did not answer slow within 30s");
    });

    it("answers timed_out after the execution bound, carrying cell_id", async () => {
      const t = tool({
        name: "run",
        description: "",
        args: { cell_id: z.string() },
        bound: execution((args) => `still running ${args.cell_id}`),
        run: never,
      });
      const call = t.call({ cell_id: "c1" });
      await jest.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS - 1);
      let settled = false;
      void call.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const result = await call;
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(textOf(result))).toEqual({
        cell_id: "c1",
        timed_out: true,
        message: "still running c1",
      });
    });

    it("says an unacknowledged change may still apply", async () => {
      const t = tool({
        name: "delete_it",
        description: "",
        args: {},
        bound: unacknowledged(),
        run: never,
      });
      const call = t.call({});
      await jest.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
      expect(textOf(await call)).toBe(
        "Pluto did not acknowledge delete_it within 30s; the connection to the notebook may be stalled, and the change may still apply — check list_cells before retrying."
      );
    });

    it("states a computed bound in its reply", async () => {
      const t = tool({
        name: "wait",
        description: "",
        args: {},
        bound: { ...reply(), ms: 45_000 },
        run: never,
      });
      const call = t.call({});
      await jest.advanceTimersByTimeAsync(45_000);
      expect(textOf(await call)).toContain("did not answer wait within 45s");
    });

    it("aborts the body's signal when the bound is reached", async () => {
      let signal: AbortSignal | undefined;
      const t = tool({
        name: "t",
        description: "",
        args: {},
        run: (_args, s) => {
          signal = s;
          return never();
        },
      });
      const call = t.call({});
      await jest.advanceTimersByTimeAsync(0);
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
      await call;
      expect(signal?.aborted).toBe(true);
    });

    it("answers still starting when a starting server does not get ready", async () => {
      const manager = fakePlutoManager({
        state: { status: "starting", url: SERVER_URL },
        overrides: { start: never },
      });
      const t = serverTool(manager, {
        name: "t",
        description: "",
        args: {},
        run: async () => "unreachable",
      });
      const call = t.call({});
      await jest.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS);
      expect(JSON.parse(textOf(await call))).toEqual({
        timed_out: true,
        message: STILL_STARTING,
      });
    });

    it("bounds opening a notebook on its own, apart from the body", async () => {
      const manager = fakePlutoManager({ overrides: { getWorker: never } });
      const t = notebookTool(manager, {
        name: "t",
        description: "",
        args: {},
        run: async () => "unreachable",
      });
      let settled = false;
      const call = t.call({ path: "/nb.jl" }).finally(() => (settled = true));
      await jest.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(
        EXECUTION_TIMEOUT_MS - REPLY_TIMEOUT_MS
      );
      expect(JSON.parse(textOf(await call))).toEqual({
        timed_out: true,
        message:
          "Pluto is still opening /nb.jl after 300s — retry the call or poll get_notebook_status.",
      });
    });

    it("names what went unanswered", async () => {
      const t = tool({
        name: "docs",
        description: "",
        args: { symbol: z.string() },
        bound: reply((args) => `the request for '${args.symbol}'`),
        run: never,
      });
      const call = t.call({ symbol: "sum" });
      await jest.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
      expect(textOf(await call)).toContain(
        "did not answer the request for 'sum'"
      );
    });
  });
});

describe("serverTool", () => {
  const ok = (manager: ReturnType<typeof fakePlutoManager>) =>
    serverTool(manager, {
      name: "t",
      description: "",
      args: {},
      run: async () => "ran",
    });

  it("runs when the server is ready", async () => {
    expect(textOf(await ok(fakePlutoManager()).call({}))).toBe("ran");
  });

  it("waits for a server that is starting", async () => {
    const manager = fakePlutoManager({
      state: { status: "starting", url: SERVER_URL },
    });
    expect(textOf(await ok(manager).call({}))).toBe("ran");
    expect(manager.start).toHaveBeenCalledTimes(1);
  });

  it.each<[ServerState, string]>([
    [
      { status: "stopped" },
      `Pluto server is not running. Start it with start_pluto_server, or use connect_to_pluto_server for one already running at ${SERVER_URL}.`,
    ],
    [
      { status: "stopping", url: SERVER_URL },
      "Pluto server is stopping; start it again with start_pluto_server.",
    ],
    [
      { status: "failed", url: SERVER_URL, reason: "port in use" },
      "Pluto server failed: port in use. Start it again with start_pluto_server.",
    ],
  ])("refuses without starting when the server is %j", async (state, text) => {
    const manager = fakePlutoManager({ state });
    const result = await ok(manager).call({});
    expect(result).toEqual({
      content: [{ type: "text", text }],
      isError: true,
    });
    expect(manager.start).not.toHaveBeenCalled();
    expect(manager.connect).not.toHaveBeenCalled();
  });
});

describe("notebookTool", () => {
  it("declares path and hands the body that notebook's worker", async () => {
    const worker = fakeWorker();
    const manager = fakePlutoManager({ worker });
    const t = notebookTool(manager, {
      name: "t",
      description: "",
      args: { cell_id: z.string() },
      run: async (args, w) => {
        expect(w).toBe(worker);
        return args;
      },
    });
    expect(Object.keys(t.shape)).toEqual(["path", "cell_id"]);
    const result = await t.call({ path: "/nb.jl", cell_id: "c1" });
    expect(JSON.parse(textOf(result))).toEqual({
      path: "/nb.jl",
      cell_id: "c1",
    });
    expect(manager.getWorker).toHaveBeenCalledWith("/nb.jl");
  });

  it("checks its precondition before opening the notebook", async () => {
    const manager = fakePlutoManager();
    const t = notebookTool(manager, {
      name: "t",
      description: "",
      args: {},
      precondition: () => {
        throw new Error("refused");
      },
      run: async () => "unreachable",
    });
    const result = await t.call({ path: "/nb.jl" });
    expect(textOf(result)).toBe("refused");
    expect(manager.getWorker).not.toHaveBeenCalled();
  });

  it("answers a notebook the manager cannot reach with the manager's error", async () => {
    const manager = fakePlutoManager({
      overrides: {
        getWorker: async () => {
          throw new Error(
            "Pluto server is stopping, so /nb.jl cannot be opened."
          );
        },
      },
    });
    const t = notebookTool(manager, {
      name: "t",
      description: "",
      args: {},
      run: async () => "unreachable",
    });
    const result = await t.call({ path: "/nb.jl" });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Pluto server is stopping, so /nb.jl cannot be opened.",
        },
      ],
      isError: true,
    });
  });
});
