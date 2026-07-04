import type { CellResultData, Worker } from "@plutojl/rainbow";
import { Host, serialize } from "@plutojl/rainbow";
import type { IPlutoServerManager, IFileReader } from "./plutoManagerTypes.ts";
import { EventEmitter } from "events";
import { unlink } from "fs/promises";

/**
 * Events emitted by PlutoManager
 */
export interface PlutoManagerEvents {
  serverStateChanged: () => void;
  notebookOpened: (notebookPath: string) => void;
  notebookClosed: (notebookPath: string) => void;
  cellUpdated: (notebookPath: string, cellId: string) => void;
  workerRecreated: (notebookPath: string, worker: Worker) => void;
}

export interface PlutoManagerLogger {
  showWarningMessage: <T extends string>(
    message: string,
    ...items: T[]
  ) => Thenable<T | undefined>;
  showInfoMessage: <T extends string>(
    message: string,
    ...items: T[]
  ) => Thenable<T | undefined>;
  showErrorMessage: <T extends string>(
    message: string,
    ...items: T[]
  ) => Thenable<T | undefined>;
}
/**
 * Manages connection to Pluto server and notebook sessions
 */
export class PlutoManager {
  private host?: Host; // Host from @plutojl/rainbow
  private readonly workers: Map<string, Worker> = new Map(); // notebook_id -> Worker
  private readonly pendingWorkers: Map<string, Promise<Worker>> = new Map(); // in-flight worker creation, keyed by path
  private startPromise?: Promise<void>; // in-flight start(), shared by concurrent callers
  private stopping = false; // suppresses "stopped unexpectedly" handling during intentional stop
  private serverUrl: string;
  private usingCustomServerUrl = false;
  private readonly notebooksToRecreate: Set<string> = new Set(); // Paths of notebooks to recreate after reconnect
  private readonly eventEmitter: EventEmitter = new EventEmitter();

  constructor(
    private readonly port = 1234,
    private readonly logger: PlutoManagerLogger,
    private readonly serverManager: IPlutoServerManager,
    private readonly fileReader: IFileReader,
    serverUrl?: string
  ) {
    if (serverUrl) {
      this.serverUrl = serverUrl;
      this.usingCustomServerUrl = true;
    } else {
      this.serverUrl = `http://localhost:${this.port}`;
    }

    // Register callback to reset state when server task stops
    this.serverManager.onStop(() => {
      this.onServerStopped();
    });

    // Register callback to update server URL when port changes
    this.serverManager.onPortChanged((newPort: number) => {
      this.serverUrl = `http://localhost:${newPort}`;
      // Update host with new URL
      if (this.host) {
        this.host = new Host(this.serverUrl);
      }
    });
  }

  /**
   * Register event listener
   */
  public on<K extends keyof PlutoManagerEvents>(
    event: K,
    listener: PlutoManagerEvents[K]
  ): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener
   */
  public off<K extends keyof PlutoManagerEvents>(
    event: K,
    listener: PlutoManagerEvents[K]
  ): void {
    this.eventEmitter.off(event, listener);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof PlutoManagerEvents>(
    event: K,
    ...args: Parameters<PlutoManagerEvents[K]>
  ): void {
    this.eventEmitter.emit(event, ...args);
  }

  /**
   * Called when server task stops unexpectedly
   */
  private onServerStopped(): void {
    if (this.stopping) {
      // Intentional stop — stop() owns worker shutdown and event emission
      return;
    }

    // Store notebook paths for recreation after reconnect
    for (const notebookPath of this.workers.keys()) {
      this.notebooksToRecreate.add(notebookPath);
    }

    // Close all workers
    for (const worker of this.workers.values()) {
      void worker.shutdown();
    }
    this.workers.clear();

    // Reset host
    this.host = undefined;

    // Emit server state changed event
    this.emit("serverStateChanged");

    // Show warning to user if server stopped unexpectedly
    if (!this.serverManager.isRunning()) {
      this.logger
        .showErrorMessage(
          "Pluto server stopped unexpectedly. Click 'Restart' to start it again.",
          "Restart"
        )
        .then((choice) => {
          if (choice === "Restart") {
            this.start().catch((error) => {
              this.logger.showErrorMessage(
                `Failed to restart Pluto server: ${error.message}`
              );
            });
          }
        });
    }
  }

  /**
   * Check if a Pluto server is available for work. With a custom server
   * URL there is no owned process — being connected is what counts.
   */
  public isRunning(): boolean {
    if (this.usingCustomServerUrl) {
      return this.isConnected();
    }
    return this.serverManager.isRunning() && this.isConnected();
  }

  /**
   * Check if connected to a host (with or without owning the process)
   */
  public isConnected(): boolean {
    return !!this.host;
  }

  /**
   * Connect to an existing Pluto server without starting a new one.
   * Fails fast with a clear error when the server is unreachable.
   */
  public async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    try {
      await fetch(this.serverUrl, { signal: AbortSignal.timeout(5000) });
    } catch (error) {
      throw new Error(
        `Cannot reach Pluto server at ${this.serverUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.host = new Host(this.serverUrl);
  }

  /**
   * Start Pluto server (or connect to custom server URL).
   * Concurrent callers share one in-flight start.
   */
  public async start(): Promise<void> {
    this.startPromise ??= this.doStart().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    // If using custom server URL, just connect without starting
    if (this.usingCustomServerUrl) {
      await this.connect();
      await this.recreateWorkers();
      return;
    }

    // Check if already running
    if (this.serverManager.isRunning()) {
      await this.serverManager.waitForReady();
      await this.connect();
      return;
    }

    await this.serverManager.start();
    await this.serverManager.waitForReady();
    await this.connect();

    // Emit server state changed event
    this.emit("serverStateChanged");

    // Recreate workers for notebooks that were open before server stopped
    await this.recreateWorkers();
  }

  /**
   * Recreate workers for notebooks that were open before server stopped
   */
  private async recreateWorkers(): Promise<void> {
    if (this.notebooksToRecreate.size === 0) {
      return;
    }

    const notebookPaths = Array.from(this.notebooksToRecreate);
    this.notebooksToRecreate.clear();

    for (const notebookPath of notebookPaths) {
      try {
        // Use getWorker to recreate the worker
        const worker = await this.getWorker(notebookPath);

        // Emit event to notify controller about recreated worker
        if (worker) {
          this.emit("workerRecreated", notebookPath, worker);
        }
      } catch (error) {
        // Log error but continue with other notebooks
        console.error(`Failed to recreate worker for ${notebookPath}:`, error);
      }
    }
  }

  /**
   * Stop Pluto server. Times out worker shutdown after 10s to avoid hanging.
   * Open notebooks are remembered and recreated on the next start().
   */
  public async stop(): Promise<void> {
    this.stopping = true;
    try {
      // Remember open notebooks so the next start() can recreate them
      for (const notebookPath of this.workers.keys()) {
        this.notebooksToRecreate.add(notebookPath);
      }

      // Close all workers with a timeout — don't let a hung worker block shutdown
      const workerShutdown = Promise.allSettled(
        [...this.workers.values()].map((worker) =>
          worker.shutdown().catch(() => {
            // Worker shutdown can fail if server is already gone — ignore
          })
        )
      );

      const timeoutMs = 10_000;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        workerShutdown,
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timeoutHandle);
      this.workers.clear();

      // Stop server process (NodeServerManager already has its own 5s SIGKILL fallback)
      if (this.serverManager.isRunning()) {
        await this.serverManager.stop();
      }

      this.host = undefined;

      // Emit server state changed event
      this.emit("serverStateChanged");
    } finally {
      this.stopping = false;
    }
  }

  /**
   * Restart Pluto server
   */
  public async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Get or create a worker for a notebook
   * @param notebookPath - File system path to the notebook
   * @param documentContent - Optional notebook content from VSCode document (overrides file read)
   * @returns Worker instance for the notebook
   */
  public async getWorker(
    notebookPath: string,
    documentContent?: string
  ): Promise<Worker | undefined> {
    if (!this.isConnected()) {
      await this.start();
    }

    // Check if we already have a worker for this notebook
    const worker = this.workers.get(notebookPath);
    if (worker) {
      if (!worker.connected) {
        await worker.connect();
      }
      return worker;
    }

    if (!this.host) {
      return undefined;
    }

    // Share one in-flight creation per path so concurrent callers
    // don't create duplicate workers for the same notebook
    let pending = this.pendingWorkers.get(notebookPath);
    if (!pending) {
      pending = this.createWorkerForPath(notebookPath, documentContent);
      this.pendingWorkers.set(notebookPath, pending);
      void pending
        .catch(() => {
          // Rejection is delivered to getWorker callers awaiting `pending`
        })
        .finally(() => {
          this.pendingWorkers.delete(notebookPath);
        });
    }
    return pending;
  }

  private async createWorkerForPath(
    notebookPath: string,
    documentContent?: string
  ): Promise<Worker> {
    const host = this.host;
    if (!host) {
      throw new Error("Cannot create worker: not connected to Pluto server");
    }

    // Get notebook content - use provided content or read from file
    let notebookContent: string;
    try {
      notebookContent =
        documentContent ?? (await this.fileReader.readFile(notebookPath));
    } catch (error) {
      throw new Error(
        `Cannot create worker: failed to read notebook file: ${error}`
      );
    }

    let worker: Worker;
    try {
      worker = await host.createWorker(notebookContent.trim());
    } catch (error) {
      throw new Error(this.describeServerError(error));
    }
    try {
      await worker.connect();

      // Tell Pluto which file this notebook lives at so it can track saves.
      // Only works when the server shares the same filesystem (localhost).
      // We must delete the file first — moveTo throws if the path already exists.
      if (this.isLocalServer()) {
        await unlink(notebookPath);
        await worker.moveTo(notebookPath);
      }

      // The server may have been stopped (or replaced) while we were
      // connecting — registering the worker now would leak it into a
      // manager whose stop() has already run
      if (this.stopping || this.host !== host) {
        throw new Error("Pluto server was stopped while opening the notebook");
      }
    } catch (error) {
      // Don't leak the worker if connect/move failed
      void worker.shutdown().catch(() => {});
      throw new Error(
        `Cannot create worker for ${notebookPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.workers.set(notebookPath, worker);

    // Emit notebook opened event
    this.emit("notebookOpened", notebookPath);

    return worker;
  }

  /**
   * Execute a cell
   */
  public async executeCell(
    worker: Worker,
    cellId: string,
    code: string
  ): Promise<CellResultData | null> {
    // Update existing cell code and run it
    await worker.updateSnippetCode(cellId, code, true);

    // Wait for execution to complete
    // await worker.wait(true);

    // Get cell result
    const cellData = worker.getSnippet(cellId);
    return cellData?.result ?? null;
  }

  /**
   * Emit cell updated event (to be called by controller)
   */
  public emitCellUpdated(notebookPath: string, cellId: string): void {
    this.emit("cellUpdated", notebookPath, cellId);
  }

  /**
   * Add a new cell to the notebook
   */
  public async addCell(
    worker: Worker,
    index: number,
    code: string
  ): Promise<string> {
    const cellId = await worker.addSnippet(index, code);
    return cellId;
  }

  /**
   * Delete a cell from the notebook
   */
  public async deleteCell(worker: Worker, cellId: string): Promise<void> {
    await worker.deleteSnippets([cellId]);
  }

  /**
   * Move cells to a new position in the notebook
   */
  public async moveCells(
    worker: Worker,
    cellIds: string[],
    index: number
  ): Promise<void> {
    await worker.moveSnippets(cellIds, index);
  }

  /**
   * Set the code_folded state of a cell (show/hide code in Pluto UI)
   */
  public async foldCell(
    worker: Worker,
    cellId: string,
    folded: boolean
  ): Promise<void> {
    if (!worker.client || !worker.notebook_state) {
      throw new Error("Not connected to notebook");
    }

    const cellInput = worker.notebook_state.cell_inputs[cellId];
    if (!cellInput) {
      throw new Error(`Cell ${cellId} not found`);
    }

    if (cellInput.code_folded === folded) {
      return; // Already in desired state
    }

    const updates = [
      {
        op: "replace" as const,
        path: ["cell_inputs", cellId, "code_folded"],
        value: folded,
      },
    ];

    await worker.client.send(
      "update_notebook",
      { updates },
      { notebook_id: worker.notebook_id },
      false
    );
  }

  /**
   * Move a notebook to a new file path via Pluto (updates Pluto's tracked path,
   * moves the file and .assets directory on the server side).
   */
  public async moveNotebook(worker: Worker, newPath: string): Promise<void> {
    await worker.moveTo(newPath);
  }

  /**
   * Turn opaque HTTP failures from the Pluto server into actionable errors.
   */
  private describeServerError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("403")) {
      return (
        `${message} — the Pluto server at ${this.serverUrl} refused the request (authentication). ` +
        `Start it with secrets disabled, e.g. ` +
        `Pluto.run(port=1234; require_secret_for_access=false, require_secret_for_open_links=false, launch_browser=false) ` +
        `— only on a machine that is not exposed to the internet.`
      );
    }
    return message;
  }

  /**
   * Whether the Pluto server is running on localhost (file paths are shared).
   */
  public isLocalServer(): boolean {
    try {
      const url = new URL(this.serverUrl);
      const host = url.hostname;
      return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "0.0.0.0"
      );
    } catch {
      return false;
    }
  }

  /**
   * Get the server URL
   */
  public getServerUrl(): string {
    return this.serverUrl;
  }

  /**
   * Get the actual port being used by the server
   * This may differ from the configured port if the configured port was unavailable
   */
  public getActualPort(): number {
    return this.serverManager.getActualPort();
  }

  /**
   * Close connection to a notebook
   * const notebookPath = notebookUri.fsPath;
   */
  public async closeNotebook(notebookPath: string): Promise<void> {
    const worker = this.workers.get(notebookPath);

    if (worker) {
      this.workers.delete(notebookPath);

      // Emit notebook closed event
      this.emit("notebookClosed", notebookPath);
      void worker.shutdown();
    }
  }

  /**
   * Get list of open notebooks
   */
  public getOpenNotebooks(): Array<{ path: string; notebookId: string }> {
    const notebooks: Array<{ path: string; notebookId: string }> = [];
    for (const [path, worker] of this.workers.entries()) {
      notebooks.push({
        path,
        notebookId: worker.notebook_id,
      });
    }
    return notebooks;
  }

  /**
   * Execute Julia code in a notebook without creating a persistent cell
   * This uses waitSnippet at index 0 and then immediately deletes the cell
   */
  public async executeCodeEphemeral(
    worker: Worker,
    code: string
  ): Promise<CellResultData> {
    // Execute code at index 0 (creates a temporary cell)
    const result = await worker.waitSnippet(0, code);

    // Delete the cell immediately after execution. Best-effort: the result
    // matters more than the cleanup, so a failed delete is not fatal.
    try {
      await worker.deleteSnippets([result.cell_id]);
    } catch {
      // Ephemeral cell stays behind — will be cleaned up with the worker
    }

    return result;
  }

  /**
   * Get the serialized notebook content (.jl format) for saving to disk
   */
  public getNotebookContent(worker: Worker): string {
    const state = worker.getState();
    if (!state) {
      throw new Error("Notebook state not available");
    }
    return serialize(state);
  }

  /**
   * Close all notebook connections
   */
  public async dispose(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.shutdown();
    }
    this.workers.clear();

    // Stop task (fire and forget - dispose is not async)
    if (this.serverManager.isRunning()) {
      await this.serverManager.stop().catch(() => {
        // Ignore errors during dispose
      });
    }
  }

  public async restartNotebook(notebookPath?: string): Promise<void> {
    try {
      // Close existing worker
      for (const notebook of this.getOpenNotebooks()) {
        if (!notebookPath || notebook.path === notebookPath) {
          await this.closeNotebook(notebook.path);

          // Wait a bit for cleanup
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Recreate worker and let listeners (controller) resubscribe
          const worker = await this.getWorker(notebook.path);
          if (worker) {
            this.emit("workerRecreated", notebook.path, worker);
          }

          void this.logger.showInfoMessage(
            `Reconnected to notebook: ${notebook.path.split("/").pop()}`
          );
        }
      }
    } catch (error) {
      void this.logger.showErrorMessage(
        `Failed to reconnect notebook: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
