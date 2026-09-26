export type OrderSyncResult = "applied" | "deferred" | "noop";

export interface ProvenanceDeps<Edit> {
  applyEdit(edit: Edit): PromiseLike<boolean>;
  log?(message: string): void;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

const MAX_ORDER_SYNC_ATTEMPTS = 60;

/**
 * Owns whether a notebook document change came from us (a Pluto-side
 * change applied to the document) or from the user, and the deferred
 * cell-order sync that applies Pluto's structure to the document.
 *
 * Every document edit goes through `applyRemote` or `replaceStructure`.
 * Only structural edits (cells added, removed or moved) produce change
 * events the controller reacts to, so only `replaceStructure` is tracked:
 * a structural change is ours when it leaves the document with exactly
 * the cell ids `replaceStructure` was asked to produce. That expectation
 * is held from the edit until the macrotask after `applyEdit` settles;
 * the change event itself is delivered before `applyEdit` resolves.
 */
export class EditProvenance<Edit> {
  private readonly expectedIds = new Map<string, { ids: readonly string[] }>();
  private readonly orderSyncTimers = new Map<string, unknown>();
  // Bumped by forget: a sync that started under an older generation
  // does not reschedule itself
  private readonly generation = new Map<string, number>();
  private disposed = false;

  constructor(private readonly deps: ProvenanceDeps<Edit>) {}

  /** Applies an edit that changes no cell structure (text, metadata). */
  applyRemote(edit: Edit): PromiseLike<boolean> {
    return this.deps.applyEdit(edit);
  }

  /**
   * Applies an edit that leaves the notebook's cells with exactly `ids`, in
   * order; the resulting change event is recognised by `isOwnStructuralChange`.
   */
  async replaceStructure(
    notebookPath: string,
    edit: Edit,
    ids: readonly string[]
  ): Promise<boolean> {
    const expectation = { ids };
    this.expectedIds.set(notebookPath, expectation);
    try {
      return await this.deps.applyEdit(edit);
    } finally {
      this.timer(() => {
        if (this.expectedIds.get(notebookPath) === expectation) {
          this.expectedIds.delete(notebookPath);
        }
      }, 0);
    }
  }

  /**
   * Whether a structural change that left the document with `ids` is the
   * one a pending `replaceStructure` produced.
   */
  isOwnStructuralChange(
    notebookPath: string,
    ids: ReadonlyArray<string | undefined>
  ): boolean {
    const expected = this.expectedIds.get(notebookPath)?.ids;
    return (
      !!expected &&
      expected.length === ids.length &&
      expected.every((id, i) => ids[i] === id)
    );
  }

  /**
   * Runs `sync` for this notebook soon, coalescing requests made while one
   * is pending. A `"deferred"` result is retried with exponential backoff
   * (100 ms doubling, capped at 5 s) up to 60 attempts.
   */
  scheduleOrderSync(
    notebookPath: string,
    sync: () => PromiseLike<OrderSyncResult>,
    attempt = 0
  ): void {
    if (this.disposed || this.orderSyncTimers.has(notebookPath)) {
      return;
    }
    const generation = this.generation.get(notebookPath) ?? 0;
    const delay = Math.min(100 * 2 ** attempt, 5000);
    const handle = this.timer(() => {
      this.orderSyncTimers.delete(notebookPath);
      Promise.resolve(sync()).then(
        (result) => {
          if (
            result === "deferred" &&
            attempt + 1 < MAX_ORDER_SYNC_ATTEMPTS &&
            generation === (this.generation.get(notebookPath) ?? 0)
          ) {
            this.scheduleOrderSync(notebookPath, sync, attempt + 1);
          }
        },
        (error: unknown) =>
          this.deps.log?.(
            `[CellOrderSync] Failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
      );
    }, delay);
    this.orderSyncTimers.set(notebookPath, handle);
  }

  /** Drops the notebook's pending order sync, and stops a running one from retrying. */
  forget(notebookPath: string): void {
    this.generation.set(
      notebookPath,
      (this.generation.get(notebookPath) ?? 0) + 1
    );
    this.expectedIds.delete(notebookPath);
    const handle = this.orderSyncTimers.get(notebookPath);
    if (handle !== undefined) {
      (this.deps.clearTimer ?? clearTimeout)(
        handle as ReturnType<typeof setTimeout>
      );
      this.orderSyncTimers.delete(notebookPath);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const notebookPath of [...this.orderSyncTimers.keys()]) {
      this.forget(notebookPath);
    }
  }

  private timer(callback: () => void, ms: number): unknown {
    return (this.deps.setTimer ?? setTimeout)(callback, ms);
  }
}

/**
 * What to do with Pluto's cell order against the document's. `ids` holds
 * each document cell's Pluto id, undefined for a local add still waiting
 * for one.
 */
export function planOrderSync(
  ids: ReadonlyArray<string | undefined>,
  plutoOrder: readonly string[],
  executionInFlight: boolean
): "apply" | "deferred" | "noop" {
  if (ids.some((id) => !id)) {
    return "deferred";
  }
  if (
    ids.length === plutoOrder.length &&
    plutoOrder.every((id, i) => ids[i] === id)
  ) {
    return "noop";
  }
  return executionInFlight ? "deferred" : "apply";
}

/**
 * Splits a user's structural change into moves, additions and removals.
 * A drag-reorder surfaces as the same Pluto id in both the added and
 * removed cells.
 */
export function classifyStructuralChange<Cell>(
  added: readonly Cell[],
  removed: readonly Cell[],
  idOf: (cell: Cell) => string | undefined
): { moved: Cell[]; added: Cell[]; removed: Cell[] } {
  const removedIds = new Set(
    removed.map(idOf).filter((id): id is string => !!id)
  );
  const isMoved = (cell: Cell) => {
    const id = idOf(cell);
    return !!id && removedIds.has(id);
  };
  const moved = added.filter(isMoved);
  const movedIds = new Set(moved.map(idOf));
  return {
    moved,
    added: added.filter((cell) => !isMoved(cell)),
    removed: removed.filter((cell) => !movedIds.has(idOf(cell))),
  };
}

/**
 * The identity an added document cell takes in Pluto:
 * - `"new"`: no usable id — Pluto assigns one
 * - `"restore"`: carries an id Pluto does not know — add it under that id
 * - `"echo"`: carries the id of a Pluto cell no other document cell has —
 *   the document caught up with Pluto (revert after autosave); nothing to send
 * - `"paste"`: carries an id another document cell also has — a copy that
 *   needs its own identity
 */
export function addedCellIdentity(
  presetId: string | undefined,
  plutoHasId: boolean,
  documentCellsWithId: number
): "new" | "restore" | "echo" | "paste" {
  if (!presetId) {
    return "new";
  }
  if (!plutoHasId) {
    return "restore";
  }
  return documentCellsWithId > 1 ? "paste" : "echo";
}
