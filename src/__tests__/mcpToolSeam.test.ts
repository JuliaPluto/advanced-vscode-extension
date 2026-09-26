import { jest } from "@jest/globals";
import { z } from "zod";
import type { ServerState } from "../plutoManager.js";
import {
  EXECUTION_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  content,
  execution,
  notebookTool,
  reply,
  serverTool,
  tool,
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

  it("describes a notebook that cannot be opened by the server state", async () => {
    const manager = fakePlutoManager({
      overrides: { getWorker: async () => undefined },
    });
    const t = notebookTool(manager, {
      name: "t",
      description: "",
      args: {},
      run: async () => "unreachable",
    });
    const result = await t.call({ path: "/nb.jl" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      `The Pluto server at ${SERVER_URL} is not ready to open /nb.jl (state: ready)`
    );
  });
});
