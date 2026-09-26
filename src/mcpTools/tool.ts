import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Worker } from "@plutojl/rainbow";
import { z } from "zod";
import type { PlutoManager, ServerState } from "../plutoManager.ts";
import { notebookPath } from "./args.ts";

/**
 * The part of PlutoManager the tool set depends on.
 */
export type PlutoToolsManager = Pick<
  PlutoManager,
  | "getState"
  | "isConnected"
  | "start"
  | "connect"
  | "stop"
  | "getServerUrl"
  | "isLocalServer"
  | "serverWritesNotebookFiles"
  | "getOpenNotebooks"
  | "getWorker"
  | "runCell"
  | "runSnippet"
  | "executeCell"
  | "setCellCode"
  | "executeCodeEphemeral"
  | "deleteCell"
  | "moveCells"
  | "foldCell"
  | "moveNotebook"
  | "getNotebookContent"
>;

/** How long a tool call may block on running notebook code. */
export const EXECUTION_TIMEOUT_MS = 5 * 60_000;

/**
 * How long a tool call may wait for something Pluto answers without
 * running notebook code: documentation, a notebook state patch, a
 * reconnect. Going unanswered this long means the connection has stalled.
 */
export const REPLY_TIMEOUT_MS = 30_000;

export type TimeoutResult<T> =
  { timedOut: false; value: T } | { timedOut: true };

/**
 * Race a promise against a timeout. After a timeout the promise keeps
 * running; its eventual rejection is swallowed.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<TimeoutResult<T>> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    return await Promise.race([
      promise.then((value): TimeoutResult<T> => ({ timedOut: false, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
    void promise.catch(() => {});
  }
}

/** A reply that is passed through as MCP content, unwrapped. */
export class ToolContent {
  constructor(readonly result: CallToolResult) {}
}

export function content(
  blocks: CallToolResult["content"],
  options: { isError?: boolean } = {}
): ToolContent {
  return new ToolContent({ content: blocks, ...options });
}

/**
 * What a tool body returns: a string becomes one text block, a
 * ToolContent passes through, any other value is sent as pretty JSON.
 */
export type ToolReply = string | ToolContent | Record<string, unknown>;

function textResult(text: string, isError?: boolean): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError && { isError }),
  };
}

function envelope(reply: ToolReply): CallToolResult {
  if (reply instanceof ToolContent) {
    return reply.result;
  }
  if (typeof reply === "string") {
    return textResult(reply);
  }
  return textResult(JSON.stringify(reply, null, 2));
}

/**
 * The longest a call may take, and what it answers when it takes longer.
 * The work itself is not cancelled.
 */
type ToolArgs = Record<string, unknown>;

export interface Bound<A = ToolArgs> {
  ms: number | ((args: A) => number);
  onTimeout(args: A, toolName: string): CallToolResult;
}

/**
 * Bound for a call that runs notebook code. Its timeout is not an error:
 * the reply says the work continues and how to wait for it.
 */
export function execution(
  message: string | ((args: ToolArgs) => string)
): Bound {
  return {
    ms: EXECUTION_TIMEOUT_MS,
    onTimeout: (args) => {
      return envelope({
        ...(args.cell_id !== undefined && { cell_id: args.cell_id }),
        timed_out: true,
        message: typeof message === "function" ? message(args) : message,
      });
    },
  };
}

/** Bound for a call that only waits for Pluto to answer. */
export function reply(what?: (args: ToolArgs) => string): Bound {
  return {
    ms: REPLY_TIMEOUT_MS,
    onTimeout: (args, toolName) =>
      textResult(
        `Pluto did not answer ${what ? what(args) : toolName} within ${REPLY_TIMEOUT_MS / 1000}s; the connection to the notebook may be stalled, and a change the call made may still apply. Check get_notebook_status or list_cells before retrying, or reopen the notebook with open_notebook.`,
        true
      ),
  };
}

/** One tool of the set: its declaration and a call that never throws. */
export interface PlutoTool {
  readonly name: string;
  readonly description: string;
  readonly shape: z.ZodRawShape;
  call(args: unknown): Promise<CallToolResult>;
}

export interface ToolSpec<S extends z.ZodRawShape> {
  name: string;
  description: string;
  args: S;
  /** Defaults to reply(). */
  bound?: Bound<NoInfer<z.output<z.ZodObject<S>>>>;
  run(args: z.output<z.ZodObject<S>>): Promise<ToolReply>;
}

/**
 * A tool: its arguments are parsed, the whole call is bounded, and its
 * reply becomes MCP content. A thrown error becomes an error result.
 */
export function tool<S extends z.ZodRawShape>(spec: ToolSpec<S>): PlutoTool {
  const schema = z.object(spec.args);
  const bound = spec.bound ?? reply();
  return {
    name: spec.name,
    description: spec.description,
    shape: spec.args,
    async call(raw) {
      try {
        const args = schema.parse(raw ?? {});
        const ms = typeof bound.ms === "function" ? bound.ms(args) : bound.ms;
        const outcome = await withTimeout(spec.run(args), ms);
        return outcome.timedOut
          ? bound.onTimeout(args, spec.name)
          : envelope(outcome.value);
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error),
          true
        );
      }
    },
  };
}

/** Why tools cannot reach the Pluto server in this state, and what to do. */
export function serverUnavailable(state: ServerState, url: string): string {
  switch (state.status) {
    case "stopping":
      return "Pluto server is stopping; start it again with start_pluto_server.";
    case "failed":
      return `Pluto server failed: ${state.reason}. Start it again with start_pluto_server.`;
    default:
      return `Pluto server is not running. Start it with start_pluto_server, or use connect_to_pluto_server for one already running at ${url}.`;
  }
}

async function requireServer(manager: PlutoToolsManager): Promise<void> {
  const state = manager.getState();
  if (state.status === "ready") {
    return;
  }
  if (state.status === "starting") {
    await manager.start();
    return;
  }
  throw new Error(serverUnavailable(state, manager.getServerUrl()));
}

/** A tool that needs a ready Pluto server; it never starts one. */
export function serverTool<S extends z.ZodRawShape>(
  manager: PlutoToolsManager,
  spec: ToolSpec<S>
): PlutoTool {
  return tool({
    ...spec,
    run: async (args) => {
      await requireServer(manager);
      return spec.run(args);
    },
  });
}

type WithPath<S extends z.ZodRawShape> = S & { path: typeof notebookPath };

export interface NotebookToolSpec<S extends z.ZodRawShape> {
  name: string;
  description: string;
  args: S;
  /** Defaults to reply(). */
  bound?: Bound<NoInfer<z.output<z.ZodObject<WithPath<S>>>>>;
  run(
    args: z.output<z.ZodObject<WithPath<S>>>,
    worker: Worker
  ): Promise<ToolReply>;
}

/**
 * A tool that operates on a notebook: it takes `path`, and its body gets
 * that notebook's worker, opening the notebook when needed.
 */
export function notebookTool<S extends z.ZodRawShape>(
  manager: PlutoToolsManager,
  spec: NotebookToolSpec<S>
): PlutoTool {
  const args = { path: notebookPath, ...spec.args } as WithPath<S>;
  return serverTool(manager, {
    ...spec,
    args,
    run: async (parsed) => {
      const { path } = parsed as { path: string };
      const worker = await manager.getWorker(path);
      if (!worker) {
        throw new Error(
          `The Pluto server at ${manager.getServerUrl()} is not ready to open ${path} (state: ${manager.getState().status})`
        );
      }
      return spec.run(parsed, worker);
    },
  });
}
