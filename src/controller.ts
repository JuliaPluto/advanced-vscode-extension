import * as vscode from "vscode";
import type { PlutoManager } from "./plutoManager.ts";
import type { NotebookData, UpdateEvent } from "@plutojl/rainbow";
import { formatCellOutput } from "./serializer.ts";
import { isDefined, isNotDefined, isEmptyString } from "./helpers.ts";

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

  private executeHandler = (
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): void | Thenable<void> => {
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
        // Find all currently running executions and mark them as failed
        for (const [cellId, execution] of this.activeExecutions.entries()) {
          execution.end(false, Date.now());
          this.activeExecutions.delete(cellId);
        }

        await worker.interrupt();
        vscode.window.showInformationMessage("Notebook execution interrupted");
      } catch (error) {
        this.outputChannel.appendLine(`Error interrupting notebook: ${error}`);
        vscode.window.showErrorMessage("Failed to interrupt execution");
      }
    }
  };

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

    // Setup messaging bridge between controller and renderer
    this.setupMessaging();
  }

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

  private startExecution(
    cellId: CellId,
    notebook: vscode.NotebookDocument
  ): vscode.NotebookCellExecution {
    let execution = this.activeExecutions.get(cellId);
    if (!execution) {
      this.outputChannel.appendLine(
        `[EXEC INIT] Starting initial execution for cell ${cellId}`
      );
      const notebookCell = this.getCellByPlutoId(notebook, cellId);
      if (!notebookCell) {
        throw new Error("Can not determine notebook cell");
      }
      execution = this.controller.createNotebookCellExecution(notebookCell);
      this.activeExecutions.set(cellId, execution);
      execution.start(Date.now());
    }
    return execution;
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
    const isStarting = isDefined(patch.value) && segment2 === "running";
    if (segment2 === "running") {
      this.plutoManager.emitCellUpdated(notebook.uri.fsPath, cellId);
    }
    if (isStarting) {
      // Start execution
      const execution = this.startExecution(cellId, notebook);
      execution.replaceOutput([formatCellOutput(currentCellState)]);
    }

    // 2. Update Cell Output (only if an execution object exists)
    if (segment2 === "output") {
      // Handle final output/result update
      const execution = this.startExecution(cellId, notebook);
      // execution.replaceOutput([formatCellOutput(currentCellState)]);

      this.outputChannel.appendLine(
        `[OUTPUT] Cell ${cellId} for notebook ${notebook.uri} output updated.`
      );

      execution.end(true, Date.now());
      this.activeExecutions.delete(cellId);
      this.outputChannel.appendLine(`[EXEC END] Cell ${cellId} finished.`);
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

  /**
   * Handles cell reordering when Pluto's execution order changes.
   */
  private async _handleCellReorder(
    _notebook: vscode.NotebookDocument,
    _plutoNotebook: NotebookData
  ): Promise<void> {
    this.outputChannel.appendLine(`  Reorder happens here`);
    void _notebook;
    void _plutoNotebook;
    // Replca them in a bulk? drawbacks ???
    // A cell can be removed, added or reordered

    // try {
    //   // Build a map of current VS Code cell positions
    //   const currentCells = notebook.getCells();
    //   const currentOrder: CellId[] = [];
    //   const cellMap = new Map<CellId, vscode.NotebookCell>();

    //   for (const cell of currentCells) {
    //     const cellId = cell.metadata?.pluto_cell_id as string;
    //     if (cellId) {
    //       currentOrder.push(cellId);
    //       cellMap.set(cellId, cell);
    //     }
    //   }

    //   // Check if reordering is needed
    //   const needsReorder = plutoOrder.some(
    //     (id, idx) => currentOrder[idx] !== id
    //   );
    //   if (!needsReorder) {
    //     this.outputChannel.appendLine(
    //       `[CellReorder] Cell order already matches Pluto order`
    //     );
    //     return;
    //   }

    //   this.outputChannel.appendLine(
    //     `[CellReorder] Reordering cells to match Pluto order`
    //   );
    //   this.outputChannel.appendLine(`  Current: ${currentOrder.join(", ")}`);
    //   this.outputChannel.appendLine(`  Pluto:   ${plutoOrder.join(", ")}`);

    //   // Build the edit to reorder cells
    //   const edit = new vscode.WorkspaceEdit();
    //   const cellsToMove: vscode.NotebookCellData[] = [];

    //   // Collect cells in the new order
    //   for (const cellId of plutoOrder) {
    //     const cell = cellMap.get(cellId);
    //     if (cell) {
    //       const cellData = new vscode.NotebookCellData(
    //         cell.kind,
    //         cell.document.getText(),
    //         cell.document.languageId
    //       );
    //       cellData.metadata = cell.metadata;
    //       cellData.outputs = [...cell.outputs]; // Create mutable copy
    //       cellsToMove.push(cellData);
    //     }
    //   }

    //   // Replace all cells with the reordered cells
    //   edit.set(notebook.uri, [
    //     vscode.NotebookEdit.replaceCells(
    //       new vscode.NotebookRange(0, currentCells.length),
    //       cellsToMove
    //     ),
    //   ]);

    //   await vscode.workspace.applyEdit(edit);
    //   this.outputChannel.appendLine(
    //     `[CellReorder] Cells reordered successfully`
    //   );
    // } catch (error) {
    //   const errorMessage =
    //     error instanceof Error ? error.message : String(error);
    //   this.outputChannel.appendLine(
    //     `[CellReorder] Failed to reorder cells: ${errorMessage}`
    //   );
    // }
  }
  private updateAllCellsFromState = (
    notebook: vscode.NotebookDocument,
    update: UpdateEvent
  ) => {
    // Optimistically send data. May be ignored.
    // If not ignored, this makes sure logs, stdout and progress
    // are properly propagated to state object
    const fullNotebookState = update.notebook;
    Object.entries(fullNotebookState?.cell_results ?? {}).forEach(
      ([cell_id, state]) => {
        this.sendMessageToRenderer(notebook, {
          type: "setState",
          state,
          cell_id,
        });
      }
    );
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
          this.outputChannel.appendLine(
            `[UNHANDLED]: Received non-patch update or missing state: ${event.type}`
          );
          return;
        }
        let anyWeird = false;
        for (const patch of patches) {
          const path = patch.path;
          const [action, ...rest] = path;
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
            case "cell_input": {
              if (rest[1] === "code" && patch.op === "replace") {
                // TODO here we need to update the code for the cell
              }

              this.outputChannel.appendLine(
                `[UNHANDLED] cell_input ${patch.path.join(".")} action ${
                  patch.op
                }`
              );
              break;
            }
            case "cell_results":
              this._handleCellPatch(notebook, patch, fullNotebookState);
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
              if (patch.op === "replace") {
                // A cell can be removed, added or reordered
                void this._handleCellReorder(notebook, fullNotebookState);
              } else {
                this.outputChannel.appendLine(
                  `[LogInternal] Cell dependencies updated: ${
                    patch.op
                  } on cell ${rest.join(".")}`
                );
              }
              break;
            }
            case "last_save_time":
              break;
            default:
              anyWeird = true;
              this.outputChannel.appendLine(
                `[UNHANDLED]  ${patch.path.join(".")} action ${patch.op}`
              );
          }
        }
        if (anyWeird) {
          console.log("Not sure if all ok, updating everything");
          this.updateAllCellsFromState(notebook, event);
        }
      } catch (e: unknown) {
        this.updateAllCellsFromState(notebook, event);
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

      // Only initialize if server is running
      if (this.plutoManager.isRunning()) {
        try {
          const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);
          if (worker) {
            this.outputChannel.appendLine(
              `Worker initialized for: ${notebook.uri.fsPath}`
            );

            // Subscribe to updates from this worker
            worker.onUpdate(this.onPlutoNotebookUpdate(notebook));
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
        // Prepare code - wrap markdown cells properly
        const code = prepareCellCodeForWorker(addedCell);
        const cellIndex = notebook.getCells().indexOf(addedCell);

        this.outputChannel.appendLine(`Adding new cell at index ${cellIndex}`);

        // Add cell to worker and get the assigned cell ID
        const cellId = await this.plutoManager.addCell(worker, cellIndex, code);

        this.outputChannel.appendLine(`Cell added with ID: ${cellId}`);

        // Update the cell's metadata with the Pluto cell ID
        const edit = new vscode.WorkspaceEdit();
        const cellMetadata = {
          ...addedCell.metadata,
          pluto_cell_id: cellId,
        };

        edit.set(notebook.uri, [
          vscode.NotebookEdit.updateCellMetadata(cellIndex, cellMetadata),
        ]);

        await vscode.workspace.applyEdit(edit);

        this.outputChannel.appendLine(
          `Updated cell metadata with pluto_cell_id: ${cellId}`
        );
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

    if (!this.plutoManager.isRunning()) {
      this.outputChannel.appendLine(
        "Server not running - skipping cell change handling"
      );
      return;
    }

    // Process cell changes
    // for (const _change of event.cellChanges) {
    // Handle cell metadata or output changes - we don't need to do anything here
    // The worker will handle these through its update events
    // }

    // Process content changes (cell additions/deletions)
    for (const change of event.contentChanges) {
      await this.handleVscodeAddedCells(notebook, change.addedCells);
      await this.handleVscodeRemovedCells(notebook, change.removedCells);
    }
  }

  public async dispose(): Promise<void> {
    this.controller.dispose();
    // NotebookRendererMessaging doesn't have a dispose method
    await this.plutoManager.dispose();
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
    const execution = this.startExecution(cellId, notebook);

    try {
      if (!this.plutoManager.isRunning()) {
        throw new Error(
          "Pluto server is not running. Please start the server first."
        );
      }

      const worker = await this.plutoManager.getWorker(notebook.uri.fsPath);

      if (!worker) {
        throw new Error(`Failed to initialize Pluto worker.`);
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

      // If an error occurred BEFORE even talking to the kernel, we end the execution immediately.
      execution?.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(error as Error),
        ]),
      ]);
      execution?.end(false, Date.now());
      this.activeExecutions.delete(cellId);

      // Show error notification for critical failures
      if (errorMessage.includes("server") || errorMessage.includes("worker")) {
        vscode.window.showErrorMessage(
          `Cell execution failed: ${errorMessage}`
        );
      }
    }
  }
}
