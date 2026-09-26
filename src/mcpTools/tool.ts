import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Worker } from "@plutojl/rainbow";
import { z } from "zod";
import {
  describeServerState,
  type PlutoManager,
  type ServerState,
} from "../plutoManager.ts";
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
  | "capabilities"
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

type ToolArgs = Record<string, unknown>;

/**
 * The longest a tool body may take, and what the call answers when it
 * takes longer. The body is signalled but not cancelled.
 */
export interface Bound<A = ToolArgs> {
  ms: number | ((args: A) => number);
  onTimeout(args: A, toolName: string, ms: number): CallToolResult;
}

function timedOut(args: ToolArgs, message: string): CallToolResult {
  return envelope({
    ...(args.cell_id !== undefined && { cell_id: args.cell_id }),
    timed_out: true,
    message,
  });
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
    onTimeout: (args) =>
      timedOut(args, typeof message === "function" ? message(args) : message),
  };
}

/** Bound for a read that only waits for Pluto to answer. */
export function reply(subject?: (args: ToolArgs) => string): Bound {
  return {
    ms: REPLY_TIMEOUT_MS,
    onTimeout: (args, toolName, ms) =>
      textResult(
        `Pluto did not answer ${subject ? subject(args) : toolName} within ${ms / 1000}s; the connection to the notebook may be stalled. Check get_notebook_status, or reopen the notebook with open_notebook.`,
        true
      ),
  };
}

/** Bound for a change that only waits for Pluto to acknowledge it. */
export function unacknowledged(): Bound {
  return {
    ms: REPLY_TIMEOUT_MS,
    onTimeout: (_args, toolName, ms) =>
      textResult(
        `Pluto did not acknowledge ${toolName} within ${ms / 1000}s; the connection to the notebook may be stalled, and the change may still apply — check list_cells before retrying.`,
        true
      ),
  };
}

export const STILL_STARTING = `The Pluto server is still starting after ${EXECUTION_TIMEOUT_MS / 1000}s and keeps starting — poll get_notebook_status until server_state is ready.`;

/** Ends a call early with `result`, from any phase of it. */
class BoundReached extends Error {
  constructor(readonly result: CallToolResult) {
    super("bound reached");
  }
}

async function bounded<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => CallToolResult
): Promise<T> {
  const outcome = await withTimeout(promise, ms);
  if (outcome.timedOut) {
    throw new BoundReached(onTimeout());
  }
  return outcome.value;
}

/** One tool of the set: its declaration and a call that never throws. */
export interface PlutoTool {
  readonly name: string;
  readonly description: string;
  readonly shape: z.ZodRawShape;
  call(args: unknown): Promise<CallToolResult>;
}

interface Definition<C> {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  bound?: Bound;
  /** Runs before the body, outside its bound; bounds its own waits. */
  prepare(args: ToolArgs): Promise<C>;
  run(args: ToolArgs, context: C, signal: AbortSignal): Promise<ToolReply>;
}

function define<C>(definition: Definition<C>): PlutoTool {
  const schema = z.object(definition.shape);
  const bound = definition.bound ?? reply();
  return {
    name: definition.name,
    description: definition.description,
    shape: definition.shape,
    async call(raw) {
      const controller = new AbortController();
      try {
        const args = schema.parse(raw ?? {}) as ToolArgs;
        const context = await definition.prepare(args);
        const ms = typeof bound.ms === "function" ? bound.ms(args) : bound.ms;
        const outcome = await withTimeout(
          definition.run(args, context, controller.signal),
          ms
        );
        if (outcome.timedOut) {
          controller.abort();
          return bound.onTimeout(args, definition.name, ms);
        }
        return envelope(outcome.value);
      } catch (error) {
        if (error instanceof BoundReached) {
          return error.result;
        }
        return textResult(
          error instanceof Error ? error.message : String(error),
          true
        );
      }
    },
  };
}

type Output<S extends z.ZodRawShape> = z.output<z.ZodObject<S>>;

export interface ToolSpec<S extends z.ZodRawShape> {
  name: string;
  description: string;
  args: S;
  /** Defaults to reply(). */
  bound?: Bound<NoInfer<Output<S>>>;
  /** `signal` aborts when the bound is reached. */
  run(args: Output<S>, signal: AbortSignal): Promise<ToolReply>;
}

/**
 * A tool: its arguments are parsed, its body is bounded, and its reply
 * becomes MCP content. A thrown error becomes an error result.
 */
export function tool<S extends z.ZodRawShape>(spec: ToolSpec<S>): PlutoTool {
  return define({
    name: spec.name,
    description: spec.description,
    shape: spec.args,
    bound: spec.bound as Bound | undefined,
    prepare: async () => undefined,
    run: (args, _context, signal) => spec.run(args as Output<S>, signal),
  });
}

/** Why tools cannot reach the Pluto server in this state, and what to do. */
export function serverUnavailable(state: ServerState, url: string): string {
  const described = describeServerState(state);
  switch (state.status) {
    case "stopping":
      return `${described}; start it again with start_pluto_server.`;
    case "failed":
      return `${described}. Start it again with start_pluto_server.`;
    default:
      return `${described}. Start it with start_pluto_server, or use connect_to_pluto_server for one already running at ${url}.`;
  }
}

/**
 * Proceed on a ready server, wait (bounded) for one that is starting,
 * refuse otherwise. Never starts a server.
 */
async function requireServer(
  manager: PlutoToolsManager,
  args: ToolArgs
): Promise<void> {
  const state = manager.getState();
  if (state.status === "ready") {
    return;
  }
  if (state.status === "starting") {
    await bounded(manager.start(), EXECUTION_TIMEOUT_MS, () =>
      timedOut(args, STILL_STARTING)
    );
    return;
  }
  throw new Error(serverUnavailable(state, manager.getServerUrl()));
}

/**
 * The worker for a notebook, opening it when needed. Opening is bounded
 * on its own; its timeout answers timed_out, whatever the tool.
 */
export async function resolveNotebook(
  manager: PlutoToolsManager,
  path: string
): Promise<Worker> {
  return bounded(manager.getWorker(path), EXECUTION_TIMEOUT_MS, () =>
    timedOut(
      {},
      `Pluto is still opening ${path} after ${EXECUTION_TIMEOUT_MS / 1000}s — retry the call or poll get_notebook_status.`
    )
  );
}

/** A tool that needs a ready Pluto server; it never starts one. */
export function serverTool<S extends z.ZodRawShape>(
  manager: PlutoToolsManager,
  spec: ToolSpec<S>
): PlutoTool {
  return define({
    name: spec.name,
    description: spec.description,
    shape: spec.args,
    bound: spec.bound as Bound | undefined,
    prepare: (args) => requireServer(manager, args),
    run: (args, _context, signal) => spec.run(args as Output<S>, signal),
  });
}

type WithPath<S extends z.ZodRawShape> = S & { path: typeof notebookPath };

export interface NotebookToolSpec<S extends z.ZodRawShape> {
  name: string;
  description: string;
  args: S;
  /** Defaults to reply(). */
  bound?: Bound<NoInfer<Output<WithPath<S>>>>;
  /** Checked before the notebook is resolved; throw to refuse. */
  precondition?(args: Output<WithPath<S>>): void;
  /** `signal` aborts when the bound is reached. */
  run(
    args: Output<WithPath<S>>,
    worker: Worker,
    signal: AbortSignal
  ): Promise<ToolReply>;
}

/**
 * A tool that operates on a notebook: it takes `path`, and its body gets
 * that notebook's worker from resolveNotebook.
 */
export function notebookTool<S extends z.ZodRawShape>(
  manager: PlutoToolsManager,
  spec: NotebookToolSpec<S>
): PlutoTool {
  return define({
    name: spec.name,
    description: spec.description,
    shape: { path: notebookPath, ...spec.args },
    bound: spec.bound as Bound | undefined,
    prepare: async (args) => {
      await requireServer(manager, args);
      spec.precondition?.(args as Output<WithPath<S>>);
      return resolveNotebook(manager, args.path as string);
    },
    run: (args, worker, signal) =>
      spec.run(args as Output<WithPath<S>>, worker, signal),
  });
}
