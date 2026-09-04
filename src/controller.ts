import * as vscode from "vscode";

const EXTENSION_ID = "juliapluto-pankgeorg.advanced-vscode-extension";
import type { PlutoManager } from "./plutoManager.ts";
import type {
  CellResultData,
  NotebookData,
  UpdateEvent,
} from "@plutojl/rainbow";
import { formatCellOutput, serializerOptions } from "./serializer.ts";
import {
  extractMarkdownContent,
  createVsCodeCellFromPlutoCell,
} from "./plutoSerializer.ts";
import { isDefined, isNotDefined, isEmptyString } from "./helpers.ts";
import { type Worker } from "@plutojl/rainbow";

/**
 * Prepare cell code for Pluto worker
 * Wraps markdown cells in #VSCODE-MARKDOWN marker and md""" syntax
 */
function prepareCellCodeForWorker(cell: vscode.NotebookCell): string {
  const code = cell.document.getText();

  // If it's a markdown cell, wrap it properly for Pluto
  if (cell.kind === vscode.NotebookCellKind.Markup) {
    return `#VSCODE-MARKDOWN\nmd"""\n${code}\n"""`;
  }

  return code;
}

// --- START: Merged Interfaces ---

/** A unique identifier for a cell, typically a UUID string. */
type CellId = string;

/** An RFC 6902 JSON Patch operation. */
interface Patch {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: Array<string | number>;
  value?: any;
  from?: Array<string | number>;
}
// --- END: Merged Interfaces ---

export class PlutoNotebookController {
  public readonly controllerId = "pluto-notebook-controller";
  public readonly notebookType = "pluto-notebook";
  public readonly label = "Pluto Notebook";
  public readonly supportedLanguages = ["julia"];
  private readonly controller: vscode.NotebookController;
  // Map to store Pluto notebook ID to VS Code URI (only used for the worker lookup)
  // Map to track active VS Code execution objects for streaming updates
  private readonly activeExecutions: Map<CellId, vscode.NotebookCellExecution> =
    new Map();
  // Renderer messaging API
  private rendererMessaging?: vscode.NotebookRendererMessaging;
  // Track worker subscriptions to prevent duplicates and allow cleanup
  private readonly workerSubscriptions: Map<string, () => void> = new Map();
  // While > 0 for a notebook path, document changes come from us applying
  // remote (Pluto-side) edits and must not be echoed back to Pluto
  private readonly remoteEditDepth: Map<string, number> = new Map();
  // Notebook paths with a cell-order sync already scheduled
  private readonly pendingOrderSync: Set<string> = new Set();
  // last_run_timestamp of the most recently rendered result per cell;
  // a result is re-rendered only when its stamp differs
  private readonly lastRenderedStamp: Map<CellId, number> = new Map();
  /**
   * Notebooks VS Code has bound this controller to. Cell executions can
   * only be created for bound notebooks; results that arrive earlier are
   * rendered from the worker's state once the binding happens.
   */
  private readonly selectedNotebooks: Set<string> = new Set();
  private readonly selectionAttempts: Map<string, Promise<void>> = new Map();
  private readonly listeners: vscode.Disposable[] = [];

  private executeHandler = (
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): void | Thenable<void> => {
    this.selectedNotebooks.add(notebook.uri.toString());
    for (const cell of cells) {
      void this._doExecution(cell, notebook);
    }
  };

  private interruptHandler = async (
    notebook: vscode.NotebookDocument
  ): Promise<void> => {
    const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);
    if (worker) {
      try {
        await worker.interrupt();
        vscode.window.showInformationMessage("Notebook execution interrupted");
      } catch (error) {
        this.outputChannel.appendLine(`Error interrupting notebook: ${error}`);
        vscode.window.showErrorMessage("Failed to interrupt execution");
      } finally {
        // End this notebook's executions after the interrupt attempt —
        // waiting until now stops late patches from resurrecting them as
        // successes, and a failed interrupt must still release the
        // spinners (a still-running kernel will just re-create them)
        this.endExecutionsForNotebook(notebook);
      }
    }
  };

  /**
   * End (as failed) all active executions belonging to one notebook.
   * Executions of other notebooks are left untouched.
   */
  private endExecutionsForNotebook(notebook: vscode.NotebookDocument): void {
    const cellsById = this.getCodeCellRecord(notebook);
    for (const [cellId, execution] of this.activeExecutions.entries()) {
      if (cellsById[cellId]) {
        try {
          execution.end(false, Date.now());
        } catch {
          // Execution may already be resolved
        }
        this.activeExecutions.delete(cellId);
      }
    }
  }

  constructor(
    private readonly plutoManager: PlutoManager,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    this.controller = vscode.notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this.controller.supportedLanguages = this.supportedLanguages;
    this.controller.supportsExecutionOrder = true;
    this.controller.executeHandler = this.executeHandler;
    this.controller.interruptHandler = this.interruptHandler;

    this.listeners.push(
      this.controller.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
        const key = notebook.uri.toString();
        if (selected) {
          this.selectedNotebooks.add(key);
          this.outputChannel.appendLine(
            `[KERNEL] Bound to ${notebook.uri.fsPath}`
          );
          void this.renderCurrentState(notebook);
        } else {
          this.selectedNotebooks.delete(key);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("pluto-notebook.foldHiddenCells")) {
          for (const notebook of vscode.workspace.notebookDocuments) {
            if (notebook.notebookType === this.notebookType) {
              void this.applyFoldSetting(notebook);
            }
          }
        }
      }),
      vscode.window.onDidChangeVisibleNotebookEditors((editors) => {
        for (const editor of editors) {
          if (editor.notebook.notebookType === this.notebookType) {
            void this.ensureSelected(editor.notebook);
          }
        }
      })
    );

    // Setup messaging bridge between controller and renderer
    this.setupMessaging();

    // Listen for worker recreation after server restart
    this.plutoManager.on("workerRecreated", this.onWorkerRecreated);

    // When the server goes away, no more patches will arrive — end all
    // in-flight executions instead of letting them spin forever
    this.plutoManager.on("serverStateChanged", this.onServerStateChanged);
  }

  private onWorkerRecreated = (notebookPath: string, worker: Worker): void => {
    this.handleWorkerRecreated(notebookPath, worker);
  };

  private onServerStateChanged = (): void => {
    if (this.plutoManager.isConnected()) {
      return;
    }
    for (const execution of this.activeExecutions.values()) {
      try {
        execution.end(false, Date.now());
      } catch {
        // Execution may already be resolved
      }
    }
    this.activeExecutions.clear();
  };

  /**
   * Setup communication bridge between controller and renderer
   */
  private setupMessaging(): void {
    // Create messaging API for communicating with the renderer
    this.rendererMessaging = vscode.notebooks.createRendererMessaging(
      "pluto-output-renderer"
    );

    // Listen for messages from the renderer (PlutoOutput component)
    this.rendererMessaging.onDidReceiveMessage((event) => {
      void this.handleRendererMessage(event);
    });
  }

  /**
   * Handle messages received from the renderer
   */
  private async handleRendererMessage(event: {
    editor: vscode.NotebookEditor;
    message: any;
  }): Promise<void> {
    const { editor, message } = event;

    this.outputChannel.appendLine(
      `[RENDERER MESSAGE] Received: ${JSON.stringify(message)}`
    );

    // Placeholder: Handle different message types from renderer
    switch (message.type) {
      case "bond": {
        const worker = await this.plutoManager.getWorker(
          editor.notebook.uri.fsPath
        );
        await worker?.setBond(message.name, message.value);
        this.outputChannel.appendLine(
          `[RENDERER MESSAGE] Bond set${message.name}=${message.value} for ${editor.notebook.uri}!`
        );

        this.sendMessageToRenderer(editor.notebook, {
          type: "bond",
          content: "ok",
          cell_id: message.cell_id,
        });
        break;
      }
      default:
        this.outputChannel.appendLine(`[UNKNOWN MESSAGE TYPE] ${message.type}`);
    }
  }

  /**
   * Send a message to the renderer for a specific notebook
   */
  public sendMessageToRenderer(
    notebook: vscode.NotebookDocument,
    message: any
  ): void {
    // Find ALL editors for this notebook (handles split views)
    const editors = vscode.window.visibleNotebookEditors.filter(
      (e) => e.notebook === notebook
    );

    if (editors.length > 0 && this.rendererMessaging) {
      // Send message to all editors displaying this notebook
      for (const editor of editors) {
        this.rendererMessaging.postMessage(message, editor);
      }
      this.outputChannel.appendLine(
        `[CONTROLLER MESSAGE] Sent to ${editors.length} editor(s): ${JSON.stringify(message)}`
      );
    }
  }

  private getCodeCellRecord(
    notebook: vscode.NotebookDocument
  ): Record<CellId, vscode.NotebookCell> {
    return Object.fromEntries(
      notebook
        .getCells()
        .map((cell) => [cell.metadata?.pluto_cell_id as string, cell])
    );
  }
  /**
   * Finds the VS Code cell associated with a Pluto cell ID.
   */
  private getCellByPlutoId(
    notebook: vscode.NotebookDocument,
    plutoCellId: CellId
  ): vscode.NotebookCell | undefined {
    return this.getCodeCellRecord(notebook)[plutoCellId];
  }

  /**
   * Subscribe to worker updates, cleaning up any existing subscription
   */
  private isSelectedFor(notebook: vscode.NotebookDocument): boolean {
    return this.selectedNotebooks.has(notebook.uri.toString());
  }

  /**
   * Ask VS Code to bind this controller to the notebook. Binding normally
   * happens when the user runs a cell; a notebook whose cells run first on
   * the Pluto side (opened through the tool server, or auto-run on open)
   * needs it requested explicitly before any output can be shown.
   */
  private ensureSelected(notebook: vscode.NotebookDocument): Promise<void> {
    const key = notebook.uri.toString();
    if (this.selectedNotebooks.has(key)) {
      return Promise.resolve();
    }
    const pending = this.selectionAttempts.get(key);
    if (pending) {
      return pending;
    }
    const attempt = (async () => {
      this.controller.updateNotebookAffinity(
        notebook,
        vscode.NotebookControllerAffinity.Preferred
      );
      const editor = vscode.window.visibleNotebookEditors.find(
        (e) => e.notebook === notebook
      );
      if (!editor) {
        return;
      }
      try {
        await vscode.commands.executeCommand("notebook.selectKernel", {
          notebookEditor: editor,
          id: this.controllerId,
          extension: EXTENSION_ID,
        });
      } catch (error) {
        this.outputChannel.appendLine(
          `[KERNEL] Could not select controller for ${notebook.uri.fsPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    })().finally(() => this.selectionAttempts.delete(key));
    this.selectionAttempts.set(key, attempt);
    return attempt;
  }

  /** Render every settled result the notebook's worker currently holds. */
  private async renderCurrentState(
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    const notebookPath = notebook.uri.fsPath;
    if (!this.workerSubscriptions.has(notebookPath)) {
      return;
    }
    const worker = await this.plutoManager.getWorker(notebookPath);
    const state = worker?.getState();
    if (state) {
      this.reconcileCellsFromState(notebook, state);
    }
  }

  private subscribeToWorker(
    notebookPath: string,
    notebook: vscode.NotebookDocument,
    worker: Worker
  ): void {
    // Unsubscribe from old worker if exists
    const oldUnsubscribe = this.workerSubscriptions.get(notebookPath);
    if (oldUnsubscribe) {
      oldUnsubscribe();
      this.outputChannel.appendLine(
        `[SUBSCRIPTION] Cleaned up old subscription for ${notebookPath}`
      );
    }

    // Subscribe to new worker
    const unsubscribe = worker.onUpdate(this.onPlutoNotebookUpdate(notebook));
    this.workerSubscriptions.set(notebookPath, unsubscribe);

    this.outputChannel.appendLine(
      `[SUBSCRIPTION] Subscribed to updates for ${notebookPath}`
    );

    // The worker does not replay state to new subscribers — render any
    // results it already holds (e.g. a notebook reopened while its worker
    // stayed alive)
    const state = worker.getState();
    if (state) {
      this.reconcileCellsFromState(notebook, state);
    }
  }

  /**
   * Handle worker recreation after server restart
   */
  private handleWorkerRecreated(
    notebookPath: string,
    worker: import("@plutojl/rainbow").Worker
  ): void {
    this.outputChannel.appendLine(
      `[WORKER RECREATED] Resubscribing to ${notebookPath}`
    );

    // Find the corresponding VSCode notebook document
    const notebook = vscode.workspace.notebookDocuments.find(
      (doc) => doc.uri.fsPath === notebookPath
    );

    if (notebook) {
      // Executions tied to the dead worker will never receive their
      // end patches — fail them before resubscribing
      this.endExecutionsForNotebook(notebook);
      this.subscribeToWorker(notebookPath, notebook, worker);
    } else {
      this.outputChannel.appendLine(
        `[WORKER RECREATED] No open VSCode document found for ${notebookPath}`
      );
    }
  }

  private startExecution(
    cellId: CellId,
    notebook: vscode.NotebookDocument
  ):
    | { execution: vscode.NotebookCellExecution; cell: vscode.NotebookCell }
    | undefined {
    // Cells created outside VSCode (ephemeral terminal cells, MCP
    // create_cell) have no notebook counterpart — callers skip them
    const cell = this.getCellByPlutoId(notebook, cellId);
    if (!cell) {
      return undefined;
    }
    let execution = this.activeExecutions.get(cellId);

    if (!execution) {
      if (!this.isSelectedFor(notebook)) {
        void this.ensureSelected(notebook);
        return undefined;
      }
      this.outputChannel.appendLine(
        `[EXEC INIT] Starting initial execution for cell ${cellId}`
      );

      execution = this.controller.createNotebookCellExecution(cell);
      this.activeExecutions.set(cellId, execution);
      execution.start(Date.now());
    }
    return { execution, cell };
  }

  private recordRenderedStamp(cellId: CellId, state: CellResultData): void {
    const stamp = state.output?.last_run_timestamp;
    if (stamp) {
      this.lastRenderedStamp.set(cellId, stamp);
    }
  }

  private finishExecution(
    cellId: CellId,
    execution: vscode.NotebookCellExecution,
    state: CellResultData
  ): void {
    // Render before ending: the stamp recorded below marks this result
    // as drawn, so the output must actually be on screen by then
    try {
      execution.replaceOutput([formatCellOutput(state)]);
    } catch {
      // Execution may already be resolved
    }
    try {
      execution.end(!state.errored, Date.now());
    } catch {
      // Execution may already be resolved
    }
    this.activeExecutions.delete(cellId);
    this.recordRenderedStamp(cellId, state);
    this.outputChannel.appendLine(`[EXEC END] Cell ${cellId} finished.`);
  }

  /**
   * Renders a finished cell result outside the patch-driven execution flow
   * (bulk `cells_updated` events, late output patches). The synthetic
   * execution's duration reflects Pluto's recorded runtime.
   */
  private materializeCellResult(
    notebook: vscode.NotebookDocument,
    cell: vscode.NotebookCell,
    cellId: CellId,
    state: CellResultData
  ): void {
    if (!this.isSelectedFor(notebook)) {
      void this.ensureSelected(notebook);
      return;
    }
    const now = Date.now();
    const runtimeMs = (state.runtime ?? 0) / 1e6;
    const execution = this.controller.createNotebookCellExecution(cell);
    execution.start(now - runtimeMs);
    execution.replaceOutput([formatCellOutput(state)]);
    execution.end(!state.errored, now);
    this.recordRenderedStamp(cellId, state);
    this.sendMessageToRenderer(notebook, {
      type: "setState",
      state,
      cell_id: cellId,
    });
    this.plutoManager.emitCellUpdated(notebook.uri.fsPath, cellId);
  }

  /**
   * Reconciles all cell outputs against a full notebook state snapshot.
   * Used for update events that carry no patches (e.g. `cells_updated`
   * after a reactive re-run) — renders every settled cell whose result
   * changed since it was last drawn.
   */
  private reconcileCellsFromState(
    notebook: vscode.NotebookDocument,
    state: NotebookData
  ): void {
    for (const [cellId, cellState] of Object.entries(
      state.cell_results ?? {}
    )) {
      if (cellState.queued || cellState.running) {
        continue;
      }
      if (this.activeExecutions.has(cellId)) {
        continue;
      }
      const stamp = cellState.output?.last_run_timestamp;
      if (!stamp || stamp === this.lastRenderedStamp.get(cellId)) {
        continue;
      }
      const cell = this.getCellByPlutoId(notebook, cellId);
      if (!cell) {
        continue;
      }
      this.outputChannel.appendLine(
        `[RECONCILE] Cell ${cellId} result changed (errored=${cellState.errored}) — rendering.`
      );
      this.materializeCellResult(notebook, cell, cellId, cellState);
    }
  }
  /**
   * Handles cell-specific patch updates (execution status, output, logs).
   */
  private _handleCellPatch(
    notebook: vscode.NotebookDocument,
    patch: Patch,
    fullNotebookState: NotebookData
  ): void {
    const path = patch.path;
    const cellId = path[1] as CellId;

    const currentCellState = fullNotebookState.cell_results[cellId];
    if (!currentCellState) {
      // Patch for a cell that no longer exists (remove op, or an
      // ephemeral cell already deleted) — end any leftover execution
      const execution = this.activeExecutions.get(cellId);
      if (execution) {
        try {
          execution.end(false, Date.now());
        } catch {
          // Execution may already be resolved
        }
        this.activeExecutions.delete(cellId);
      }
      return;
    }

    const body = currentCellState.output?.body;
    try {
      // the state (which comes from `execution.replaceOutput([formatCellOutput])`)) is
      // serialized differently than postMessage (which JSONifies stuff)
      // Here we adjust for the case of binary data (e.g. svg/other images)
      // which leave the websocket as UintArrays and get JSON.stringified to {0: byte...}
      // TODO: this probably needs to happen at @plutojl/rainbow (which would then guarantee serializability)
      // Since this only happens once per image, it's probably _fine_ --pg
      if (
        currentCellState.output.mime &&
        typeof body === "object" &&
        (body instanceof Uint8Array || body instanceof ArrayBuffer)
      ) {
        currentCellState.output.body = new TextDecoder().decode(
          new Uint8Array(body)
        );
      }
    } catch (err) {
      console.error(`Serialization of ArrayBuffer in a string failed`, {
        err,
        body,
        type: typeof body,
        cellId,
      });
      // TextDecoder returns type error if body isn't an array buffer of sorts
    }

    // Optimistically send data. May be ignored.
    // If not ignored, this makes sure logs, stdout and progress
    // is communicated
    this.sendMessageToRenderer(notebook, {
      type: "setState",
      state: currentCellState,
      cell_id: currentCellState.cell_id,
    });

    const segment2 = path[2];

    // 1. Update Cell Execution Status (queued, running)
    if (segment2 === "running") {
      this.plutoManager.emitCellUpdated(notebook.uri.fsPath, cellId);
      if (patch.value === true) {
        const started = this.startExecution(cellId, notebook);
        if (started) {
          const formatted = formatCellOutput(currentCellState);
          started.execution.replaceOutput([formatted]);
        }
      } else {
        // Cell stopped running — if the final output patch already arrived
        // in this batch (or none is coming), close out the execution here
        const active = this.activeExecutions.get(cellId);
        if (active && !currentCellState.queued && !currentCellState.running) {
          this.finishExecution(cellId, active, currentCellState);
        }
      }
    }

    // 2. Update Cell Output
    if (segment2 === "output") {
      const cell = this.getCellByPlutoId(notebook, cellId);
      if (!cell) {
        return;
      }
      const active = this.activeExecutions.get(cellId);
      if (!active) {
        // No execution in flight: render only results not yet drawn
        const stamp = currentCellState.output?.last_run_timestamp;
        if (!stamp || stamp === this.lastRenderedStamp.get(cellId)) {
          return;
        }
        this.outputChannel.appendLine(
          `[OUTPUT LATE] Cell ${cellId} result changed outside an execution — rendering.`
        );
        this.materializeCellResult(notebook, cell, cellId, currentCellState);
        return;
      }

      this.outputChannel.appendLine(
        `[OUTPUT] Cell ${cellId} for notebook ${notebook.uri} output updated.`
      );
      // While the cell is still queued/running this is streaming display
      // output — keep the execution open until the run completes
      if (!currentCellState.queued && !currentCellState.running) {
        this.finishExecution(cellId, active, currentCellState);
      } else {
        active.replaceOutput([formatCellOutput(currentCellState)]);
      }
    } else if (segment2 === "logs") {
      // Handle streaming logs (logs are added, path.length === 4, or array is cleared)
      if (patch.op === "add" && path.length === 4) {
        const lastLog =
          currentCellState?.logs?.[currentCellState.logs.length - 1];
        if (isDefined(lastLog)) {
          // Log the raw event to the output channel
          this.outputChannel.appendLine(`[CELL LOG] ${cellId}: ${lastLog.msg}`);
          // A proper implementation would update the cell's log output here.
        }
      }
    }

    // 3. Update Cell Metadata/Runtime
    if (segment2 === "runtime") {
      this.outputChannel.appendLine(
        `[UpdateMetadata] Cell ${cellId} runtime recorded: ${patch.value} ns`
      );
    }
  }

  private isApplyingRemoteEdit(notebookPath: string): boolean {
    return (this.remoteEditDepth.get(notebookPath) ?? 0) > 0;
  }

  /**
   * Schedule a cell-order sync for this notebook. Coalesces the multiple
   * cell_order patches a single structural change produces. A deferred
   * sync (id-less cell or execution in flight) is retried with backoff so
   * remote structural changes are never silently dropped.
   */
  private scheduleCellOrderSync(
    notebook: vscode.NotebookDocument,
    attempt = 0
  ): void {
    const key = notebook.uri.fsPath;
    if (this.pendingOrderSync.has(key)) {
      return;
    }
    this.pendingOrderSync.add(key);
    const delay = Math.min(100 * 2 ** attempt, 5000);
    setTimeout(() => {
      this.pendingOrderSync.delete(key);
      void this._handleCellReorder(notebook)
        .then((result) => {
          if (result === "deferred" && attempt < 60) {
            this.scheduleCellOrderSync(notebook, attempt + 1);
          }
        })
        .catch((error) => {
          this.outputChannel.appendLine(
            `[CellOrderSync] Failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
    }, delay);
  }

  /**
   * Make the VSCode notebook reflect Pluto's current cell set and order.
   * Cells present in both keep their VSCode content and outputs; cells
   * created outside VSCode (MCP tools, Pluto's browser UI) are
   * materialized from Pluto state; cells deleted remotely disappear.
   */
  private async _handleCellReorder(
    notebook: vscode.NotebookDocument
  ): Promise<"applied" | "deferred" | "noop"> {
    const notebookPath = notebook.uri.fsPath;
    const worker = await this.plutoManager.getWorker(notebookPath);
    if (!worker) {
      return "noop";
    }
    const state = worker.getState();
    const cellInputs = state?.cell_inputs ?? {};
    const plutoOrder = (state?.cell_order ?? []).filter(
      (id: string) => cellInputs[id]
    );

    const currentCells = notebook.getCells();
    const currentOrder = currentCells.map(
      (cell) => cell.metadata?.pluto_cell_id as string | undefined
    );

    // A cell without an id is a local add whose Pluto round trip hasn't
    // assigned metadata yet — replacing cells now would destroy it
    if (currentOrder.some((id) => !id)) {
      this.outputChannel.appendLine(
        `[CellOrderSync] Deferred — local cell add in flight`
      );
      return "deferred";
    }

    const inSync =
      currentOrder.length === plutoOrder.length &&
      plutoOrder.every((id: string, i: number) => currentOrder[i] === id);
    if (inSync) {
      return "noop";
    }

    // replaceCells would orphan in-flight executions bound to the old cell
    // objects — wait until this notebook's cells have settled
    const hasActiveExecution = currentOrder.some(
      (id) => id && this.activeExecutions.has(id)
    );
    if (hasActiveExecution) {
      this.outputChannel.appendLine(
        `[CellOrderSync] Deferred — execution in flight`
      );
      return "deferred";
    }

    const cellByPlutoId = new Map(
      currentCells.map((cell) => [cell.metadata?.pluto_cell_id as string, cell])
    );

    const notebookState = state as NotebookData;
    const desired: vscode.NotebookCellData[] = [];
    for (const cellId of plutoOrder) {
      const existing = cellByPlutoId.get(cellId);
      if (existing) {
        const data = new vscode.NotebookCellData(
          existing.kind,
          existing.document.getText(),
          existing.document.languageId
        );
        data.metadata = existing.metadata;
        data.outputs = [...existing.outputs];
        desired.push(data);
        continue;
      }

      // Cell created outside VSCode — materialize it from Pluto state
      try {
        const data = createVsCodeCellFromPlutoCell(notebookState, cellId);
        if (data) {
          desired.push(data);
          this.recordRenderedStamp(
            cellId,
            notebookState.cell_results?.[cellId] ?? ({} as CellResultData)
          );
        }
      } catch (error) {
        this.outputChannel.appendLine(
          `[CellOrderSync] Skipping unmaterializable cell ${cellId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    this.outputChannel.appendLine(
      `[CellOrderSync] Applying remote structure: ${currentOrder.length} -> ${plutoOrder.length} cells`
    );

    this.beginRemoteEdit(notebookPath);
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.set(notebook.uri, [
        vscode.NotebookEdit.replaceCells(
          new vscode.NotebookRange(0, currentCells.length),
          desired
        ),
      ]);
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.endRemoteEditSoon(notebookPath);
    }
    return "applied";
  }

  private beginRemoteEdit(notebookPath: string): void {
    this.remoteEditDepth.set(
      notebookPath,
      (this.remoteEditDepth.get(notebookPath) ?? 0) + 1
    );
  }

  /**
   * Releases remote-edit suppression on the next tick — change events may
   * be delivered after applyEdit resolves.
   */
  private endRemoteEditSoon(notebookPath: string): void {
    setTimeout(() => {
      const depth = this.remoteEditDepth.get(notebookPath) ?? 1;
      if (depth <= 1) {
        this.remoteEditDepth.delete(notebookPath);
      } else {
        this.remoteEditDepth.set(notebookPath, depth - 1);
      }
    }, 0);
  }

  /**
   * Applies a Pluto-side code edit to the matching VSCode cell's text.
   * A patch matching the cell's current text is an echo and is dropped.
   */
  /**
   * Set a cell's fold-related metadata in the document. code_folded is
   * what the serializer writes; inputCollapsed is what VS Code displays.
   */
  private async setCellFoldMetadata(
    notebook: vscode.NotebookDocument,
    cell: vscode.NotebookCell,
    folded: boolean,
    collapse: boolean
  ): Promise<void> {
    const current = cell.metadata ?? {};
    const next: Record<string, unknown> = { ...current, code_folded: folded };
    if (collapse) {
      next.inputCollapsed = folded;
    } else {
      delete next.inputCollapsed;
    }
    if (
      current.code_folded === next.code_folded &&
      current.inputCollapsed === next.inputCollapsed
    ) {
      return;
    }
    const notebookPath = notebook.uri.fsPath;
    this.beginRemoteEdit(notebookPath);
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.set(notebook.uri, [
        vscode.NotebookEdit.updateCellMetadata(cell.index, next),
      ]);
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.endRemoteEditSoon(notebookPath);
    }
  }

  /** Pluto folded or unfolded a cell (browser UI, fold_cell): reflect it in the editor. */
  private async _applyRemoteFold(
    notebook: vscode.NotebookDocument,
    cellId: CellId,
    folded: boolean
  ): Promise<void> {
    const cell = this.getCellByPlutoId(notebook, cellId);
    if (!cell) {
      return;
    }
    await this.setCellFoldMetadata(
      notebook,
      cell,
      folded,
      serializerOptions().foldHiddenCells
    );
    this.outputChannel.appendLine(
      `[FoldSync] Cell ${cellId} ${folded ? "folded" : "unfolded"} from Pluto`
    );
  }

  /** The user collapsed or expanded a cell's input in VS Code: fold it in Pluto. */
  private async handleVscodeMetadataChange(
    notebook: vscode.NotebookDocument,
    cell: vscode.NotebookCell
  ): Promise<void> {
    if (!serializerOptions().foldHiddenCells) {
      return;
    }
    const cellId = cell.metadata?.pluto_cell_id as CellId | undefined;
    if (!cellId) {
      return;
    }
    const collapsed = cell.metadata?.inputCollapsed === true;
    if (collapsed === (cell.metadata?.code_folded === true)) {
      return;
    }
    await this.setCellFoldMetadata(notebook, cell, collapsed, true);
    const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);
    if (worker) {
      await this.plutoManager.foldCell(worker, cellId, collapsed);
      this.outputChannel.appendLine(
        `[FoldSync] Cell ${cellId} ${collapsed ? "folded" : "unfolded"} in Pluto`
      );
    }
  }

  /** Re-apply the fold setting to every cell of an open notebook. */
  private async applyFoldSetting(
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    const collapse = serializerOptions().foldHiddenCells;
    for (const cell of notebook.getCells()) {
      await this.setCellFoldMetadata(
        notebook,
        cell,
        cell.metadata?.code_folded === true,
        collapse
      );
    }
  }

  private async _applyRemoteCodeEdit(
    notebook: vscode.NotebookDocument,
    cellId: CellId,
    rawCode: string
  ): Promise<void> {
    const cell = this.getCellByPlutoId(notebook, cellId);
    if (!cell) {
      return;
    }
    let newText = rawCode ?? "";
    if (cell.kind === vscode.NotebookCellKind.Markup) {
      const markdown = extractMarkdownContent(newText);
      if (isDefined(markdown)) {
        newText = markdown;
      }
    }
    if (cell.document.getText() === newText) {
      return;
    }
    const notebookPath = notebook.uri.fsPath;
    this.beginRemoteEdit(notebookPath);
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        cell.document.uri,
        new vscode.Range(0, 0, cell.document.lineCount, 0),
        newText
      );
      await vscode.workspace.applyEdit(edit);
      this.outputChannel.appendLine(
        `[CodeSync] Cell ${cellId} code updated from Pluto`
      );
    } finally {
      this.endRemoteEditSoon(notebookPath);
    }
  }

  private updateAllCellsFromState = async (
    notebook: vscode.NotebookDocument,
    update: UpdateEvent
  ) => {
    console.warn("Using nuclear reset flow");
    // Optimistically send data. May be ignored.
    // If not ignored, this makes sure logs, stdout and progress
    // are properly propagated to state object
    const fullNotebookState = update.notebook;
    for (const [cell_id, state] of Object.entries(
      fullNotebookState?.cell_results ?? {}
    )) {
      const start = Date.now();
      const started = this.startExecution(cell_id, notebook);
      if (!started) {
        continue;
      }
      const { execution } = started;
      try {
        await execution.replaceOutput([formatCellOutput(state)]);
      } catch (e) {
        console.error(e);
        //
      }
      if (!state.queued && !state.running) {
        try {
          execution.end(!state.errored, start + (state.runtime ?? 0) / 1e6);
          this.activeExecutions.delete(cell_id);
          this.recordRenderedStamp(cell_id, state);
        } catch (x) {
          console.error(x);
        }
      }
      this.sendMessageToRenderer(notebook, {
        type: "setState",
        state,
        cell_id,
      });
    }
  };

  /**
   * Handles streaming updates from the Pluto worker via patches.
   */
  private onPlutoNotebookUpdate = (notebook: vscode.NotebookDocument) => {
    return (event: UpdateEvent) => {
      try {
        const patches = event.data?.patches as Patch[] | undefined;
        const fullNotebookState = event.notebook;

        if (!patches || !fullNotebookState) {
          if (fullNotebookState) {
            // Patch-less events (cells_updated after a reactive re-run,
            // cell_local_update, …) still carry the full notebook state —
            // reconcile outputs against it instead of dropping the update
            this.outputChannel.appendLine(
              `[RECONCILE] Non-patch update (${event.type}) — reconciling from full state`
            );
            this.reconcileCellsFromState(notebook, fullNotebookState);
          } else {
            this.outputChannel.appendLine(
              `[UNHANDLED]: Received non-patch update with missing state: ${event.type}`
            );
          }
          return;
        }

        for (const patch of patches) {
          const path = patch.path;
          const [action, ...rest] = path;
          if (path.length === 0 && patches.length === 1) {
            // This is a state reset; handle it accordingly and break
            void this.updateAllCellsFromState(notebook, event).catch(
              (error) => {
                this.outputChannel.appendLine(
                  `Failed to reset cells from state: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              }
            );
            break;
          }
          switch (action) {
            case "bonds": {
              // TODO here we do bound send to the renderers
              const ref = rest[0];
              const value =
                patch.op === "add" ? patch.value?.value : patch.value;
              this.outputChannel.appendLine(
                `[BONDS] ref = ${ref} value = ${value} action ${patch.op}`
              );
              break;
            }
            case "cell_inputs": {
              if (rest[1] === "code" && patch.op === "replace") {
                void this._applyRemoteCodeEdit(
                  notebook,
                  rest[0] as CellId,
                  patch.value as string
                ).catch((error) => {
                  this.outputChannel.appendLine(
                    `[CodeSync] Failed for ${rest[0]}: ${
                      error instanceof Error ? error.message : String(error)
                    }`
                  );
                });
              }
              if (rest[1] === "code_folded" && patch.op === "replace") {
                void this._applyRemoteFold(
                  notebook,
                  rest[0] as CellId,
                  patch.value === true
                ).catch((error) => {
                  this.outputChannel.appendLine(
                    `[FoldSync] Failed for ${rest[0]}: ${
                      error instanceof Error ? error.message : String(error)
                    }`
                  );
                });
              }
              // Other cell_inputs fields (cell_id, metadata) have no
              // document representation; structural add/remove is
              // handled via cell_order sync
              break;
            }
            case "cell_results":
              // Isolate per-patch failures so one bad patch doesn't drop
              // the remaining cells' updates from the same batch
              try {
                this._handleCellPatch(notebook, patch, fullNotebookState);
              } catch (error) {
                this.outputChannel.appendLine(
                  `Failed to apply cell patch for ${patch.path.join(".")}: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              }
              break;
            case "process_status":
              this.outputChannel.appendLine(
                `[UpdateKernelStatus] Kernel process status changed to: ${patch.value}`
              );
              break;
            case "nbpkg":
              this.outputChannel.appendLine(
                `[LogInternal] Package environment setting changed: ${rest.join(
                  "."
                )} = ${patch.value}`
              );
              break;
            case "status_tree":
              this.outputChannel.appendLine(
                `[LogInternal] Internal status updated: /${path.join("/")}`
              );
              break;
            case "cell_order": {
              // Adds, removes, and reorders all mutate cell_order — sync
              // the VSCode view to Pluto's structure (coalesced)
              if (
                patch.op === "replace" ||
                patch.op === "add" ||
                patch.op === "remove"
              ) {
                this.scheduleCellOrderSync(notebook);
              }
              break;
            }
            case "last_save_time":
              break;
            default:
              this.outputChannel.appendLine(
                `[UNHANDLED]  ${patch.path.join(".")} action ${patch.op}`
              );
          }
        }
      } catch (e: unknown) {
        // console.log("Failed to process")
        // this.updateAllCellsFromState(notebook, event);
        this.outputChannel.appendLine(
          `Failed to process patch update: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    };
  };

  public async registerNotebookDocument(
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    if (notebook.notebookType === "pluto-notebook") {
      this.outputChannel.appendLine(`Notebook opened: ${notebook.uri.fsPath}`);
      void this.ensureSelected(notebook);

      // Only initialize if server is running
      if (this.plutoManager.isRunning()) {
        try {
          const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);

          if (worker) {
            this.outputChannel.appendLine(
              `Worker initialized for: ${notebook.uri.fsPath}`
            );

            // Subscribe to updates from this worker (manages cleanup automatically)
            this.subscribeToWorker(notebook.uri.fsPath, notebook, worker);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(
            `Failed to initialize worker: ${errorMessage}`
          );
          vscode.window.showErrorMessage(
            `Failed to initialize Pluto notebook: ${errorMessage}`
          );
        }
      } else {
        this.outputChannel.appendLine(
          "Server not running - worker will be initialized on first execution"
        );
      }
    }
  }

  /**
   * Handle added cells in the notebook
   */
  private async handleVscodeAddedCells(
    notebook: vscode.NotebookDocument,
    addedCells: readonly vscode.NotebookCell[]
  ): Promise<void> {
    const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);
    if (!worker) {
      this.outputChannel.appendLine("No worker available for notebook");
      return;
    }
    for (const addedCell of addedCells) {
      try {
        let presetId = addedCell.metadata?.pluto_cell_id as string | undefined;
        if (presetId && worker.getState()?.cell_inputs?.[presetId]) {
          const docCellsWithId = notebook
            .getCells()
            .filter((c) => c.metadata?.pluto_cell_id === presetId);
          if (docCellsWithId.length > 1) {
            // Paste keeps the source cell's metadata — this is a copy that
            // must become an independent Pluto cell, not an alias
            this.outputChannel.appendLine(
              `[VSCodeAdd] Cell ${presetId} is a pasted duplicate — assigning a new identity`
            );
            presetId = undefined;
          } else {
            // The id maps to exactly this cell: an echo of Pluto-side state
            // (document revert after Pluto autosaved, or our replaceCells)
            this.outputChannel.appendLine(
              `[VSCodeAdd] Cell ${presetId} already exists in Pluto — skipping echo`
            );
            continue;
          }
        }

        // Prepare code - wrap markdown cells properly
        const code = prepareCellCodeForWorker(addedCell);
        const cellIndex = notebook.getCells().indexOf(addedCell);

        this.outputChannel.appendLine(`Adding new cell at index ${cellIndex}`);

        // Add cell to worker, preserving an existing identity if the cell
        // carries one (e.g. restored from a file)
        const cellId = await this.plutoManager.addCell(
          worker,
          cellIndex,
          code,
          presetId
        );

        this.outputChannel.appendLine(`Cell added with ID: ${cellId}`);

        // Recompute the index — the notebook may have changed during the
        // round trip, and a stale index would tag the wrong cell
        const currentIndex = notebook.getCells().indexOf(addedCell);
        if (currentIndex === -1) {
          this.outputChannel.appendLine(
            `Cell removed while being added — deleting ${cellId} from Pluto`
          );
          await this.plutoManager.deleteCell(worker, cellId);
          continue;
        }

        // Identity already stamped (cell carried its id into the add)
        if (addedCell.metadata?.pluto_cell_id === cellId) {
          continue;
        }

        // Update the cell's metadata with the Pluto cell ID
        const edit = new vscode.WorkspaceEdit();
        const cellMetadata = {
          ...addedCell?.metadata,
          pluto_cell_id: cellId,
        };

        edit.set(notebook.uri, [
          vscode.NotebookEdit.updateCellMetadata(currentIndex, cellMetadata),
        ]);

        await vscode.workspace.applyEdit(edit);

        this.outputChannel.appendLine(
          `Updated cell metadata with pluto_cell_id: ${cellId}`
        );

        // A structural sync deferred on this id-less cell can proceed now
        this.scheduleCellOrderSync(notebook);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`Failed to add cell: ${errorMessage}`);
        vscode.window.showErrorMessage(
          `Failed to add cell to Pluto notebook: ${errorMessage}`
        );
      }
    }
  }

  /**
   * Handle removed cells from the notebook
   */
  private async handleVscodeRemovedCells(
    notebook: vscode.NotebookDocument,
    removedCells: readonly vscode.NotebookCell[]
  ): Promise<void> {
    const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);
    if (!worker) {
      this.outputChannel.appendLine("No worker available for notebook");
      return;
    }
    for (const removedCell of removedCells) {
      try {
        const cellId = removedCell.metadata?.pluto_cell_id as string;

        if (!cellId) {
          this.outputChannel.appendLine(
            "Skipping removal of cell without pluto_cell_id"
          );
          continue;
        }

        // A cell whose identity survives elsewhere in the document was
        // replaced, not removed
        if (
          notebook.getCells().some((c) => c.metadata?.pluto_cell_id === cellId)
        ) {
          this.outputChannel.appendLine(
            `[VSCodeRemove] Cell ${cellId} still present in document — skipping delete`
          );
          continue;
        }

        this.outputChannel.appendLine(`Deleting cell with ID: ${cellId}`);

        // Remove cell from worker
        await this.plutoManager.deleteCell(worker, cellId);

        // Clean up any active execution
        this.activeExecutions.delete(cellId);

        this.outputChannel.appendLine(`Cell ${cellId} deleted successfully`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`Failed to delete cell: ${errorMessage}`);
        vscode.window.showErrorMessage(
          `Failed to delete cell from Pluto notebook: ${errorMessage}`
        );
      }
    }
  }

  /**
   * Handle notebook document changes (cell additions/deletions)
   */
  public async handleVsCodeNotebookChange(
    event: vscode.NotebookDocumentChangeEvent
  ): Promise<void> {
    const notebook = event.notebook;

    if (notebook.notebookType !== "pluto-notebook") {
      return;
    }

    // Changes we applied ourselves from Pluto-side patches must not be
    // echoed back to Pluto — that would duplicate or re-delete cells
    if (this.isApplyingRemoteEdit(notebook.uri.fsPath)) {
      return;
    }

    if (!this.plutoManager.isRunning()) {
      this.outputChannel.appendLine(
        "Server not running - skipping cell change handling"
      );
      return;
    }

    // A collapsed/expanded input is the user folding a cell — mirror it
    // into Pluto so the file and the browser view agree
    for (const change of event.cellChanges) {
      if (change.metadata !== undefined) {
        await this.handleVscodeMetadataChange(notebook, change.cell);
      }
    }

    // A drag-reorder surfaces as the same pluto_cell_id in both the
    // removed and added lists — route those to moveCells; only genuine
    // additions and deletions go to the add/remove handlers
    const allAdded = event.contentChanges.flatMap((c) => [...c.addedCells]);
    const allRemoved = event.contentChanges.flatMap((c) => [...c.removedCells]);
    const removedIds = new Set(
      allRemoved
        .map((c) => c.metadata?.pluto_cell_id as string | undefined)
        .filter((id): id is string => !!id)
    );
    const movedCells = allAdded.filter((c) => {
      const id = c.metadata?.pluto_cell_id as string | undefined;
      return !!id && removedIds.has(id);
    });
    const movedIds = new Set(
      movedCells.map((c) => c.metadata?.pluto_cell_id as string)
    );

    for (const moved of movedCells) {
      const cellId = moved.metadata?.pluto_cell_id as string;
      const index = notebook.getCells().indexOf(moved);
      if (index === -1) {
        continue;
      }
      try {
        const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);
        if (worker) {
          this.outputChannel.appendLine(
            `[VSCodeMove] Cell ${cellId} moved to index ${index}`
          );
          await this.plutoManager.moveCells(worker, [cellId], index);
        }
      } catch (error) {
        this.outputChannel.appendLine(
          `[VSCodeMove] Failed for ${cellId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const isMoved = (c: vscode.NotebookCell) =>
      movedIds.has(c.metadata?.pluto_cell_id as string);
    const addedCells = allAdded.filter((c) => !isMoved(c));
    const removedCells = allRemoved.filter((c) => !isMoved(c));
    if (addedCells.length > 0) {
      await this.handleVscodeAddedCells(notebook, addedCells);
    }
    if (removedCells.length > 0) {
      await this.handleVscodeRemovedCells(notebook, removedCells);
    }
  }

  /**
   * Stop tracking a closed notebook: drop its worker subscription and end
   * its executions. The worker itself stays alive — MCP clients and
   * Pluto's own UI may still be using the notebook.
   */
  public handleNotebookClosed(notebook: vscode.NotebookDocument): void {
    if (notebook.notebookType !== "pluto-notebook") {
      return;
    }
    const notebookPath = notebook.uri.fsPath;
    const unsubscribe = this.workerSubscriptions.get(notebookPath);
    if (unsubscribe) {
      unsubscribe();
      this.workerSubscriptions.delete(notebookPath);
      this.outputChannel.appendLine(
        `[SUBSCRIPTION] Unsubscribed from closed notebook ${notebookPath}`
      );
    }
    this.endExecutionsForNotebook(notebook);
    // Reopening restores a document with empty outputs, so the next
    // subscription must be allowed to re-render unchanged results
    for (const cell of notebook.getCells()) {
      const cellId = cell.metadata?.pluto_cell_id as string | undefined;
      if (cellId) {
        this.lastRenderedStamp.delete(cellId);
      }
    }
  }

  public dispose(): void {
    for (const listener of this.listeners) {
      listener.dispose();
    }
    this.plutoManager.off("workerRecreated", this.onWorkerRecreated);
    this.plutoManager.off("serverStateChanged", this.onServerStateChanged);
    this.lastRenderedStamp.clear();

    for (const unsubscribe of this.workerSubscriptions.values()) {
      unsubscribe();
    }
    this.workerSubscriptions.clear();

    for (const execution of this.activeExecutions.values()) {
      try {
        execution.end(false, Date.now());
      } catch {
        // Execution may already be resolved
      }
    }
    this.activeExecutions.clear();

    this.controller.dispose();
    // The shared PlutoManager is disposed by the extension's subscriptions,
    // not here — the MCP server may outlive this controller.
  }

  private async _doExecution(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    // Execution lifecycle is now managed by the streaming patches in onNotebookUpdate.
    // Here, we just submit the job and the streaming updates will handle start/end/output.
    // If an execution is already active, reuse it, otherwise create a placeholder.

    const cellId = cell.metadata?.pluto_cell_id as string;
    if (isNotDefined(cellId) || isEmptyString(cellId)) {
      vscode.window.showErrorMessage(`Cell missing Pluto cell ID`);
      return;
    }

    // Ensure there is at least an initial execution object for this cell
    const started = this.startExecution(cellId, notebook);
    if (!started) {
      vscode.window.showErrorMessage(
        `Cell ${cellId} not found in notebook — cannot execute`
      );
      return;
    }
    const { execution } = started;

    try {
      // Get or create worker - this will start the server if needed
      const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);

      if (!worker) {
        throw new Error(`Failed to initialize Pluto worker.`);
      }

      // Ensure we're subscribed to this worker's updates
      // This handles the case where the worker was created during first execution
      // (i.e., when registration happened before server was ready)
      const notebookPath = notebook.uri.fsPath;
      if (!this.workerSubscriptions.has(notebookPath)) {
        this.outputChannel.appendLine(
          `[EXEC] No subscription found for ${notebookPath}, subscribing now`
        );
        this.subscribeToWorker(notebookPath, notebook, worker);
      }

      // Execute the cell. This sends the message to the Pluto kernel.
      // For markdown cells, wrap in proper format
      const code = prepareCellCodeForWorker(cell);

      // The worker will handle the execution and stream updates back via onNotebookUpdate.
      await this.plutoManager.executeCell(worker, cellId, code);

      // We do NOT call execution.end() here. The `onNotebookUpdate` listener
      // will handle `execution.end()` when it receives the final 'running: false' patch.
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Error executing cell: ${errorMessage}`);

      // If an error occurred BEFORE even talking to the kernel, we end the
      // execution immediately — unless a streaming patch already ended it
      if (this.activeExecutions.get(cellId) === execution) {
        try {
          execution.replaceOutput([
            new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.error(error as Error),
            ]),
          ]);
          execution.end(false, Date.now());
        } catch {
          // Execution may already be resolved
        }
        this.activeExecutions.delete(cellId);
      }

      // Show error notification for critical failures
      if (errorMessage.includes("server") || errorMessage.includes("worker")) {
        vscode.window.showErrorMessage(
          `Cell execution failed: ${errorMessage}`
        );
      }
    }
  }
}
