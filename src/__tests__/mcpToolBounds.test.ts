import { jest } from "@jest/globals";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Worker } from "@plutojl/rainbow";
import type { ServerState } from "../plutoManager.js";
import { createPlutoTools, type PlutoToolsManager } from "../mcpTools/index.js";
import {
  EXECUTION_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  STILL_STARTING,
} from "../mcpTools/tool.js";
import { SERVER_URL, never, textOf } from "./helpers/fakePlutoManager.js";

/**
 * Every method not listed in `fixtures` returns a promise that never
 * settles, so a tool cannot escape the test by calling something new.
 */
function hanging<T extends object>(fixtures: Record<string, unknown>): T {
  return new Proxy(fixtures, {
    get: (target, prop) => {
      if (prop in target) return target[prop as string];
      if (prop === "then") return undefined;
      return never;
    },
  }) as T;
}

const hangingWorker = hanging<Worker>({
  notebook_id: "nb-1",
  connected: true,
  getSnippet: () => ({
    input: { code: "plot()" },
    result: { output: { mime: "image/svg+xml", body: "<svg/>" } },
  }),
  getSnippets: () => [],
  getState: () => ({
    cell_order: ["c1"],
    cell_dependencies: { c1: { downstream_cells_map: { x: [] } } },
  }),
  isIdle: () => false,
});

function hangingManager(
  state: ServerState,
  resolution: "hangs" | "resolves"
): PlutoToolsManager {
  return hanging<PlutoToolsManager>({
    getState: () => state,
    isConnected: () => state.status === "ready",
    getServerUrl: () => SERVER_URL,
    isLocalServer: () => true,
    serverWritesNotebookFiles: () => true,
    getOpenNotebooks: () => [],
    ...(resolution === "resolves" && {
      getWorker: async () => hangingWorker,
    }),
  });
}

type Bound = "execution" | "reply" | "wait";
type Outcome = "timed_out" | "stalled" | "answers";

const BOUND_MS: Record<Bound, number> = {
  execution: EXECUTION_TIMEOUT_MS,
  reply: REPLY_TIMEOUT_MS,
  wait: 1000 + REPLY_TIMEOUT_MS,
};

interface Sample {
  tool: string;
  args: (dir: string) => Record<string, unknown>;
  bound: Bound;
  /** What it answers once everything it waits on hangs. */
  hangs: Outcome;
  stopped?: boolean;
  /** Writes to disk before it can hang; real I/O is let through first. */
  writesFile?: boolean;
  check?: (result: CallToolResult) => void;
}

const nb = { path: "/nb.jl" };
const followsUp = (result: CallToolResult) =>
  expect(textOf(result)).toContain("wait_for_notebook_idle");

const SAMPLES: Sample[] = [
  {
    tool: "learn_pluto_basics",
    args: () => ({}),
    bound: "reply",
    hangs: "answers",
  },
  {
    tool: "start_pluto_server",
    args: () => ({}),
    bound: "execution",
    hangs: "timed_out",
    stopped: true,
  },
  {
    tool: "connect_to_pluto_server",
    args: () => ({}),
    bound: "execution",
    hangs: "timed_out",
    stopped: true,
  },
  {
    tool: "stop_pluto_server",
    args: () => ({}),
    bound: "execution",
    hangs: "timed_out",
  },
  {
    tool: "get_notebook_status",
    args: () => ({}),
    bound: "reply",
    hangs: "answers",
  },
  {
    tool: "list_notebooks",
    args: () => ({}),
    bound: "reply",
    hangs: "answers",
  },
  {
    tool: "create_notebook",
    args: (dir) => ({ path: join(dir, "new.jl") }),
    bound: "execution",
    hangs: "answers",
    writesFile: true,
  },
  {
    tool: "open_notebook",
    args: () => nb,
    bound: "execution",
    hangs: "answers",
  },
  {
    tool: "move_notebook",
    args: () => ({ ...nb, new_path: "/moved.jl" }),
    bound: "execution",
    hangs: "timed_out",
  },
  {
    tool: "save_notebook",
    args: () => nb,
    bound: "execution",
    hangs: "timed_out",
  },
  {
    tool: "export_notebook_html",
    args: () => nb,
    bound: "execution",
    hangs: "timed_out",
  },
  {
    tool: "wait_for_notebook_idle",
    args: () => ({ ...nb, timeout_seconds: 1 }),
    bound: "wait",
    hangs: "answers",
  },
  {
    tool: "get_notebook_url",
    args: () => nb,
    bound: "reply",
    hangs: "answers",
  },
  {
    tool: "execute_cell",
    args: () => ({ ...nb, cell_id: "c1" }),
    bound: "execution",
    hangs: "timed_out",
    check: followsUp,
  },
  {
    tool: "create_cell",
    args: () => ({ ...nb, code: "x = 1" }),
    bound: "execution",
    hangs: "timed_out",
    check: followsUp,
  },
  {
    tool: "edit_cell",
    args: () => ({ ...nb, cell_id: "c1", code: "x = 1" }),
    bound: "execution",
    hangs: "timed_out",
    check: followsUp,
  },
  {
    tool: "edit_cell",
    args: () => ({ ...nb, cell_id: "c1", code: "x = 1", run: false }),
    bound: "execution",
    hangs: "timed_out",
  },
  {
    tool: "read_cell",
    args: () => ({ ...nb, cell_id: "c1" }),
    bound: "reply",
    hangs: "answers",
  },
  {
    tool: "execute_code",
    args: () => ({ ...nb, code: "x" }),
    bound: "execution",
    hangs: "timed_out",
    check: followsUp,
  },
  {
    tool: "get_docs",
    args: () => ({ ...nb, symbol: "x" }),
    bound: "reply",
    hangs: "stalled",
    check: (result) =>
      expect(textOf(result)).toBe(
        "Pluto did not answer the documentation request for 'x' within 30s; the connection to the notebook may be stalled. Check get_notebook_status, or reopen the notebook with open_notebook."
      ),
  },
  {
    tool: "introspect_notebook",
    args: () => nb,
    bound: "execution",
    hangs: "answers",
    check: (result) => {
      const body = JSON.parse(textOf(result));
      expect(body.symbols).toEqual([{ symbol: "x" }]);
      expect(body.message).toContain("did not answer 1 documentation request");
    },
  },
  {
    tool: "read_cell_output",
    args: () => ({ ...nb, cell_id: "c1" }),
    bound: "execution",
    hangs: "answers",
  },
  {
    tool: "read_cell_output",
    args: () => ({ ...nb, cell_id: "c1", as: "image" }),
    bound: "execution",
    hangs: "timed_out",
    check: followsUp,
  },
  {
    tool: "read_cell_output",
    args: (dir) => ({
      ...nb,
      cell_id: "c1",
      as: "file",
      output_path: join(dir, "x.png"),
    }),
    bound: "execution",
    hangs: "timed_out",
    check: followsUp,
  },
  {
    tool: "delete_cell",
    args: () => ({ ...nb, cell_id: "c1" }),
    bound: "reply",
    hangs: "stalled",
  },
  {
    tool: "move_cells",
    args: () => ({ ...nb, cell_ids: ["c1"], index: 0 }),
    bound: "reply",
    hangs: "stalled",
  },
  {
    tool: "fold_cell",
    args: () => ({ ...nb, cell_id: "c1", folded: true }),
    bound: "reply",
    hangs: "stalled",
  },
  { tool: "list_cells", args: () => nb, bound: "reply", hangs: "answers" },
];

function outcomeOf(result: CallToolResult): Outcome {
  if (result.isError) {
    expect(textOf(result)).toContain("may be stalled");
    return "stalled";
  }
  try {
    const body = JSON.parse(textOf(result));
    if (body.timed_out === true) return "timed_out";
  } catch {
    // Not JSON: an ordinary answer
  }
  return "answers";
}

/** Yield to the event loop, whose I/O the fake timers do not control. */
async function letIoThrough(done: () => boolean) {
  for (let turn = 0; turn < 1000 && !done(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const TIMEOUT_OF: Record<Bound, Outcome> = {
  execution: "timed_out",
  reply: "stalled",
  wait: "stalled",
};

describe("every tool call is bounded", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pluto-bounds-"));
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.spyOn(globalThis, "fetch").mockImplementation(never);
  });
  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function callBounded(
    sample: Sample,
    resolution: "hangs" | "resolves",
    starting = false
  ): Promise<CallToolResult> {
    const state: ServerState = starting
      ? { status: "starting", url: SERVER_URL }
      : sample.stopped
        ? { status: "stopped" }
        : { status: "ready", url: SERVER_URL };
    const tools = createPlutoTools(hangingManager(state, resolution));
    let settled = false;
    const call = tools.call(sample.tool, sample.args(dir)).finally(() => {
      settled = true;
    });
    if (sample.writesFile) {
      await letIoThrough(() => settled);
    }
    await jest.advanceTimersByTimeAsync(
      resolution === "hangs" || starting
        ? EXECUTION_TIMEOUT_MS
        : BOUND_MS[sample.bound]
    );
    expect(settled).toBe(true);
    return call;
  }

  it("samples every tool in the set", () => {
    const names = createPlutoTools(
      hangingManager({ status: "stopped" }, "hangs")
    ).tools.map((t) => t.name);
    expect(new Set(SAMPLES.map((s) => s.tool))).toEqual(new Set(names));
  });

  it.each(SAMPLES.map((s) => [s.tool, s] as const))(
    "%s settles within its bound while the notebook hangs",
    async (_name, sample) => {
      const result = await callBounded(sample, "resolves");
      const outcome = outcomeOf(result);
      expect(outcome).toBe(sample.hangs);
      if (outcome !== "answers") {
        expect(outcome).toBe(TIMEOUT_OF[sample.bound]);
      }
      sample.check?.(result);
      if (outcome === "timed_out" && "cell_id" in sample.args(dir)) {
        expect(JSON.parse(textOf(result)).cell_id).toBe("c1");
      }
    }
  );

  const opensNotebook = SAMPLES.filter((s) => "path" in s.args("/d"));

  it.each(opensNotebook.map((s) => [s.tool, s] as const))(
    "%s answers still opening while opening the notebook hangs",
    async (_name, sample) => {
      const result = await callBounded(sample, "hangs");
      expect(outcomeOf(result)).toBe("timed_out");
      const { message } = JSON.parse(textOf(result));
      if (sample.tool === "create_notebook") {
        expect(message).toContain("Do NOT retry create_notebook");
      } else {
        expect(message).toBe(
          "Pluto is still opening /nb.jl after 300s — retry the call or poll get_notebook_status."
        );
      }
    }
  );

  it.each(
    [...opensNotebook, SAMPLES.find((s) => s.tool === "list_notebooks")!].map(
      (s) => [s.tool, s] as const
    )
  )(
    "%s answers still starting while the server's start hangs",
    async (_name, sample) => {
      const result = await callBounded(sample, "resolves", true);
      expect(outcomeOf(result)).toBe("timed_out");
      expect(JSON.parse(textOf(result)).message).toBe(STILL_STARTING);
    }
  );
});
