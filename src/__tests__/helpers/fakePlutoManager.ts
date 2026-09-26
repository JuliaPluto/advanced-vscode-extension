import { jest } from "@jest/globals";
import type { Worker } from "@plutojl/rainbow";
import type { ServerState } from "../../plutoManager.js";
import type { PlutoToolsManager } from "../../mcpTools/tool.js";
import { serverCapabilities } from "../../serverCapabilities.js";

export const SERVER_URL = "http://localhost:1234";

export const never = () => new Promise<never>(() => {});

export interface FakeCell {
  cell_id: string;
  code: string;
  output?: { mime: string; body: unknown };
}

export function fakeWorker(
  cells: FakeCell[] = [
    { cell_id: "c1", code: "x = 1", output: { mime: "text/plain", body: "1" } },
  ],
  overrides: Record<string, unknown> = {}
): Worker {
  const snippet = (cell: FakeCell) => ({
    cell_id: cell.cell_id,
    input: { code: cell.code, code_folded: false },
    result: {
      output: cell.output,
      runtime: 1,
      errored: false,
      running: false,
      queued: false,
    },
  });
  return {
    notebook_id: "nb-1",
    connected: true,
    getSnippet: (id: string) => {
      const cell = cells.find((c) => c.cell_id === id);
      return cell ? snippet(cell) : null;
    },
    getSnippets: () => cells.map(snippet),
    getState: () => ({
      cell_order: cells.map((c) => c.cell_id),
      cell_dependencies: Object.fromEntries(
        cells.map((c) => [c.cell_id, { downstream_cells_map: { x: [] } }])
      ),
    }),
    getDocs: async (symbol: string) => `docs for ${symbol}`,
    isIdle: () => true,
    ...overrides,
  } as unknown as Worker;
}

/**
 * A PlutoToolsManager whose server is `state` and whose every notebook
 * resolves to `worker`. Async operations are jest mocks.
 */
export function fakePlutoManager(
  options: {
    state?: ServerState;
    worker?: Worker;
    overrides?: Partial<PlutoToolsManager>;
  } = {}
) {
  const worker = options.worker ?? fakeWorker();
  let state: ServerState = options.state ?? {
    status: "ready",
    url: SERVER_URL,
  };
  const manager = {
    getState: () => state,
    isConnected: () => state.status === "ready",
    start: jest.fn(async () => {
      state = { status: "ready", url: SERVER_URL };
    }),
    connect: jest.fn(async () => {
      state = { status: "ready", url: SERVER_URL };
    }),
    stop: jest.fn(async () => {
      state = { status: "stopped" };
    }),
    getServerUrl: () => SERVER_URL,
    capabilities: () =>
      serverCapabilities({ sharesFilesystem: true, writesNotebookFiles: true }),
    getOpenNotebooks: () => [{ path: "/nb.jl", notebookId: "nb-1" }],
    getWorker: jest.fn<(path: string) => Promise<Worker>>(async () => worker),
    runCell: jest.fn(async () => worker.getSnippet("c1")!.result),
    runSnippet: jest.fn(async () => ({
      ...worker.getSnippet("c1")!.result,
      cell_id: "new",
    })),
    executeCell: jest.fn(async () => worker.getSnippet("c1")!.result),
    setCellCode: jest.fn(async () => {}),
    executeCodeEphemeral: jest.fn(async () => worker.getSnippet("c1")!.result),
    deleteCell: jest.fn(async () => {}),
    moveCells: jest.fn(async () => {}),
    foldCell: jest.fn(async () => {}),
    moveNotebook: jest.fn(async () => {}),
    getNotebookContent: jest.fn(async () => "### A Pluto.jl notebook ###\n"),
    ...options.overrides,
  } satisfies PlutoToolsManager;
  return manager;
}

export function textOf(result: { content: unknown }): string {
  const [first] = result.content as Array<{ type: string; text?: string }>;
  return first.text ?? "";
}
