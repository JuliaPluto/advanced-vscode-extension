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
 * Every document edit goes through `applyRemote`; while one is in flight,
 * `isRemote` is true for that notebook. The notebook change event for an
 * edit is delivered before `applyEdit` resolves; the flag is still held
 * until the next macrotask.
 */
export class EditProvenance<Edit> {
  private readonly remoteDepth = new Map<string, number>();
  private readonly orderSyncTimers = new Map<string, unknown>();

  constructor(private readonly deps: ProvenanceDeps<Edit>) {}

  isRemote(notebookPath: string): boolean {
    return (this.remoteDepth.get(notebookPath) ?? 0) > 0;
  }

  async applyRemote(notebookPath: string, edit: Edit): Promise<boolean> {
    this.remoteDepth.set(
      notebookPath,
      (this.remoteDepth.get(notebookPath) ?? 0) + 1
    );
    try {
      return await this.deps.applyEdit(edit);
    } finally {
      this.timer(() => {
        const depth = this.remoteDepth.get(notebookPath) ?? 1;
        if (depth <= 1) {
          this.remoteDepth.delete(notebookPath);
        } else {
          this.remoteDepth.set(notebookPath, depth - 1);
        }
      }, 0);
    }
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
    if (this.orderSyncTimers.has(notebookPath)) {
      return;
    }
    const delay = Math.min(100 * 2 ** attempt, 5000);
    const handle = this.timer(() => {
      this.orderSyncTimers.delete(notebookPath);
      Promise.resolve(sync()).then(
        (result) => {
          if (result === "deferred" && attempt + 1 < MAX_ORDER_SYNC_ATTEMPTS) {
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

  /** Drops the notebook's pending order sync. */
  forget(notebookPath: string): void {
    const handle = this.orderSyncTimers.get(notebookPath);
    if (handle !== undefined) {
      (this.deps.clearTimer ?? clearTimeout)(
        handle as ReturnType<typeof setTimeout>
      );
      this.orderSyncTimers.delete(notebookPath);
    }
  }

  dispose(): void {
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
