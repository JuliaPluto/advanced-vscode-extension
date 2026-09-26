import type { CellResultData } from "@plutojl/rainbow";

type CellId = string;

/** The subset of vscode.NotebookCellExecution the ledger drives. */
export interface CellExecution<Output> {
  start(startTime?: number): void;
  replaceOutput(out: Output[]): PromiseLike<void> | void;
  end(success: boolean | undefined, endTime?: number): void;
}

export interface LedgerDeps<
  Cell,
  Output,
  Execution extends CellExecution<Output>,
> {
  createExecution(cell: Cell): Execution;
  formatOutput(state: CellResultData): Output;
  /** Fired once for every execution that ends, whichever way it ends. */
  onSettled(notebookPath: string, cellId: CellId): void;
  now?(): number;
}

/**
 * Owns the live cell executions of every notebook, keyed by
 * (notebook path, Pluto cell id), and the stamp of the last result drawn
 * per cell. Every execution leaves through `settle`: ended at most once,
 * removed from the ledger, and announced via `onSettled`.
 */
export class ExecutionLedger<
  Cell,
  Output,
  Execution extends CellExecution<Output> = CellExecution<Output>,
> {
  private readonly active = new Map<string, Map<CellId, Execution>>();
  // last_run_timestamp of the most recently rendered result per cell;
  // recorded only once that result is on screen
  private readonly renderedStamp = new Map<string, Map<CellId, number>>();

  constructor(private readonly deps: LedgerDeps<Cell, Output, Execution>) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The execution for this cell, created and started if none is live. */
  begin(notebookPath: string, cellId: CellId, cell: Cell): Execution {
    let executions = this.active.get(notebookPath);
    const existing = executions?.get(cellId);
    if (existing) {
      return existing;
    }
    const execution = this.deps.createExecution(cell);
    if (!executions) {
      executions = new Map();
      this.active.set(notebookPath, executions);
    }
    executions.set(cellId, execution);
    execution.start(this.now());
    return execution;
  }

  isActive(notebookPath: string, cellId: CellId): boolean {
    return this.active.get(notebookPath)?.has(cellId) ?? false;
  }

  hasActive(notebookPath: string): boolean {
    return (this.active.get(notebookPath)?.size ?? 0) > 0;
  }

  /** Streams output into the live execution; false when there is none. */
  render(notebookPath: string, cellId: CellId, state: CellResultData): boolean {
    const execution = this.active.get(notebookPath)?.get(cellId);
    if (!execution) {
      return false;
    }
    this.replaceOutput(execution, this.deps.formatOutput(state));
    return true;
  }

  /** Draws the final result into the live execution and ends it; false when none is live. */
  finish(
    notebookPath: string,
    cellId: CellId,
    state: CellResultData,
    endTime?: number
  ): boolean {
    const execution = this.active.get(notebookPath)?.get(cellId);
    if (!execution) {
      return false;
    }
    this.replaceOutput(execution, this.deps.formatOutput(state));
    this.markRendered(notebookPath, cellId, state);
    this.settle(notebookPath, cellId, execution, !state.errored, endTime);
    return true;
  }

  /**
   * Draws a result that arrived with no execution in flight, as a
   * synthetic execution whose duration is Pluto's recorded runtime.
   */
  materialize(
    notebookPath: string,
    cellId: CellId,
    cell: Cell,
    state: CellResultData
  ): void {
    const now = this.now();
    const execution = this.deps.createExecution(cell);
    execution.start(now - (state.runtime ?? 0) / 1e6);
    this.replaceOutput(execution, this.deps.formatOutput(state));
    this.end(execution, !state.errored, now);
    this.markRendered(notebookPath, cellId, state);
    this.deps.onSettled(notebookPath, cellId);
  }

  /** Whether this result still has to be drawn: settled, stamped, and not drawn yet. */
  needsRender(
    notebookPath: string,
    cellId: CellId,
    state: CellResultData
  ): boolean {
    if (this.isActive(notebookPath, cellId)) {
      return false;
    }
    const stamp = state.output?.last_run_timestamp;
    return (
      !!stamp && stamp !== this.renderedStamp.get(notebookPath)?.get(cellId)
    );
  }

  /**
   * Ends the cell's execution as failed. With `only`, a different live
   * execution for the cell is left alone.
   */
  fail(
    notebookPath: string,
    cellId: CellId,
    opts: { output?: Output; only?: Execution } = {}
  ): void {
    const execution = this.active.get(notebookPath)?.get(cellId);
    if (!execution || (opts.only && opts.only !== execution)) {
      return;
    }
    if (opts.output !== undefined) {
      this.replaceOutput(execution, opts.output);
    }
    this.settle(notebookPath, cellId, execution, false);
  }

  failNotebook(notebookPath: string): void {
    const executions = this.active.get(notebookPath);
    if (!executions) {
      return;
    }
    for (const [cellId, execution] of [...executions]) {
      this.settle(notebookPath, cellId, execution, false);
    }
  }

  failAll(): void {
    for (const notebookPath of [...this.active.keys()]) {
      this.failNotebook(notebookPath);
    }
  }

  /**
   * Fails the notebook's executions and forgets its render stamps, so a
   * document reopened at this path — or at a new one — redraws every result.
   */
  closeNotebook(notebookPath: string): void {
    this.failNotebook(notebookPath);
    this.renderedStamp.delete(notebookPath);
  }

  dispose(): void {
    this.failAll();
    this.renderedStamp.clear();
  }

  private settle(
    notebookPath: string,
    cellId: CellId,
    execution: CellExecution<Output>,
    success: boolean,
    endTime?: number
  ): void {
    this.end(execution, success, endTime ?? this.now());
    const executions = this.active.get(notebookPath);
    executions?.delete(cellId);
    if (executions?.size === 0) {
      this.active.delete(notebookPath);
    }
    this.deps.onSettled(notebookPath, cellId);
  }

  private end(
    execution: CellExecution<Output>,
    success: boolean,
    endTime: number
  ): void {
    try {
      execution.end(success, endTime);
    } catch {
      // Already resolved
    }
  }

  private replaceOutput(
    execution: CellExecution<Output>,
    output: Output
  ): void {
    try {
      void execution.replaceOutput([output]);
    } catch {
      // Already resolved
    }
  }

  /** Records a result as drawn by some path other than an execution. */
  markRendered(
    notebookPath: string,
    cellId: CellId,
    state: CellResultData
  ): void {
    const stamp = state.output?.last_run_timestamp;
    if (!stamp) {
      return;
    }
    let stamps = this.renderedStamp.get(notebookPath);
    if (!stamps) {
      stamps = new Map();
      this.renderedStamp.set(notebookPath, stamps);
    }
    stamps.set(cellId, stamp);
  }
}
