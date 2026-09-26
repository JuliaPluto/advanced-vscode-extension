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
  log?(message: string): void;
  now?(): number;
}

interface LiveExecution<Cell, Execution> {
  execution: Execution;
  cell: Cell;
  // Stamp of the result this execution last drew
  shown?: number;
}

/**
 * Owns the live cell executions of every notebook, keyed by
 * (notebook path, Pluto cell id), and the stamp of the last result drawn
 * per cell. Every execution, including a materialized one, leaves through
 * `settle`: ended at most once, removed from the ledger, and announced via
 * `onSettled`. A result stays stamped as drawn only if its output was
 * accepted: the stamp is recorded with the output and withdrawn if the
 * output is rejected.
 */
export class ExecutionLedger<
  Cell,
  Output,
  Execution extends CellExecution<Output> = CellExecution<Output>,
> {
  private readonly active = new Map<
    string,
    Map<CellId, LiveExecution<Cell, Execution>>
  >();
  // last_run_timestamp of the most recently rendered result per cell;
  // recorded only once that result is on screen
  private readonly renderedStamp = new Map<string, Map<CellId, number>>();

  constructor(private readonly deps: LedgerDeps<Cell, Output, Execution>) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * The execution for this cell, created and started if none is live. A
   * live execution bound to a different cell object is failed and replaced.
   */
  begin(notebookPath: string, cellId: CellId, cell: Cell): Execution {
    const existing = this.active.get(notebookPath)?.get(cellId);
    if (existing?.cell === cell) {
      return existing.execution;
    }
    if (existing) {
      this.settle(notebookPath, cellId, existing.execution, false);
    }
    return this.open(notebookPath, cellId, cell, this.now());
  }

  isActive(notebookPath: string, cellId: CellId): boolean {
    return this.active.get(notebookPath)?.has(cellId) ?? false;
  }

  hasActive(notebookPath: string): boolean {
    return (this.active.get(notebookPath)?.size ?? 0) > 0;
  }

  /**
   * Streams output into the live execution; false when there is none. A
   * result whose stamp is already drawn for this cell is left mounted.
   */
  render(notebookPath: string, cellId: CellId, state: CellResultData): boolean {
    const entry = this.active.get(notebookPath)?.get(cellId);
    if (!entry) {
      return false;
    }
    this.draw(notebookPath, cellId, entry, state);
    return true;
  }

  /** Draws the final result into the live execution and ends it; false when none is live. */
  finish(
    notebookPath: string,
    cellId: CellId,
    state: CellResultData,
    endTime?: number
  ): boolean {
    const entry = this.active.get(notebookPath)?.get(cellId);
    if (!entry) {
      return false;
    }
    if (this.draw(notebookPath, cellId, entry, state)) {
      this.markRendered(notebookPath, cellId, state);
    }
    this.settle(notebookPath, cellId, entry.execution, !state.errored, endTime);
    return true;
  }

  /**
   * Draws a result that arrived with no execution in flight, as a
   * synthetic execution whose duration is Pluto's recorded runtime. A live
   * execution for the cell is finished with the result instead.
   */
  materialize(
    notebookPath: string,
    cellId: CellId,
    cell: Cell,
    state: CellResultData
  ): void {
    const now = this.now();
    if (!this.isActive(notebookPath, cellId)) {
      this.open(notebookPath, cellId, cell, now - (state.runtime ?? 0) / 1e6);
    }
    this.finish(notebookPath, cellId, state, now);
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
   * Ends the cell's execution as failed. With `only` or `cell`, a live
   * execution that is not that execution, or not bound to that cell
   * object, is left alone.
   */
  fail(
    notebookPath: string,
    cellId: CellId,
    opts: { output?: Output; only?: Execution; cell?: Cell } = {}
  ): void {
    const entry = this.active.get(notebookPath)?.get(cellId);
    if (
      !entry ||
      (opts.only && opts.only !== entry.execution) ||
      (opts.cell && opts.cell !== entry.cell)
    ) {
      return;
    }
    const { execution } = entry;
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
    for (const [cellId, { execution }] of [...executions]) {
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

  private open(
    notebookPath: string,
    cellId: CellId,
    cell: Cell,
    startTime: number
  ): Execution {
    const execution = this.deps.createExecution(cell);
    let executions = this.active.get(notebookPath);
    if (!executions) {
      executions = new Map();
      this.active.set(notebookPath, executions);
    }
    executions.set(cellId, { execution, cell });
    execution.start(startTime);
    return execution;
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

  /**
   * false when the execution rejected the output synchronously;
   * `onRejected` runs when it rejects it asynchronously.
   */
  /**
   * Draws a result into a live execution unless its stamp is already
   * drawn there or settled for the cell. false when the output was refused.
   */
  private draw(
    notebookPath: string,
    cellId: CellId,
    entry: LiveExecution<Cell, Execution>,
    state: CellResultData
  ): boolean {
    const stamp = state.output?.last_run_timestamp;
    if (
      stamp &&
      (stamp === entry.shown ||
        stamp === this.renderedStamp.get(notebookPath)?.get(cellId))
    ) {
      return true;
    }
    const accepted = this.replaceOutput(
      entry.execution,
      this.deps.formatOutput(state),
      () => {
        if (entry.shown === stamp) {
          entry.shown = undefined;
        }
        const stamps = this.renderedStamp.get(notebookPath);
        if (stamp && stamps?.get(cellId) === stamp) {
          stamps.delete(cellId);
        }
      }
    );
    if (accepted) {
      entry.shown = stamp;
    }
    return accepted;
  }

  private replaceOutput(
    execution: CellExecution<Output>,
    output: Output,
    onRejected?: () => void
  ): boolean {
    try {
      const pending = execution.replaceOutput([output]);
      if (pending) {
        pending.then(undefined, (error: unknown) => {
          this.deps.log?.(`[LEDGER] replaceOutput rejected: ${String(error)}`);
          onRejected?.();
        });
      }
      return true;
    } catch {
      return false;
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
