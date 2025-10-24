import type { CellResultData, Worker } from "@plutojl/rainbow";
import { Host } from "@plutojl/rainbow";
import { readFile } from "fs/promises";
import { PlutoServerTaskManager } from "./plutoServerTask.js";
import { EventEmitter } from "events";

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
  private serverUrl: string;
  private readonly taskManager: PlutoServerTaskManager;
  private usingCustomServerUrl = false;
  private readonly notebooksToRecreate: Set<string> = new Set(); // Paths of notebooks to recreate after reconnect
  private readonly eventEmitter: EventEmitter = new EventEmitter();

  constructor(
    private readonly port = 1234,
    private readonly logger: PlutoManagerLogger,
    serverUrl?: string
  ) {
    if (serverUrl) {
      this.serverUrl = serverUrl;
      this.usingCustomServerUrl = true;
    } else {
      this.serverUrl = `http://localhost:${this.port}`;
    }

    this.taskManager = new PlutoServerTaskManager(this.port);

    // Register callback to reset state when server task stops
    this.taskManager.onStop(() => {
      this.onServerStopped();
    });

    // Register callback to update server URL when port changes
    this.taskManager.onPortChanged((newPort: number) => {
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
    // Store notebook paths for recreation after reconnect
    this.notebooksToRecreate.clear();
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
    if (!this.taskManager.isRunning()) {
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
   * Check if Pluto server is running
   */
  public isRunning(): boolean {
    return this.taskManager.isRunning() && this.isConnected();
  }

  /**
   * Check if connected to a host (with or without owning the process)
   */
  public isConnected(): boolean {
    return !!this.host;
  }

  /**
   * Connect to an existing Pluto server without starting a new one
   */
  public async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    this.host = new Host(this.serverUrl);
  }

  /**
   * Start Pluto server (or connect to custom server URL)
   */
  public async start(): Promise<void> {
    // If using custom server URL, just connect without starting
    if (this.usingCustomServerUrl) {
      await this.connect();
      await this.recreateWorkers();
      return;
    }

    // Check if already running
    if (this.taskManager.isRunning()) {
      return;
    }

    await this.taskManager.start();
    await this.taskManager.waitForReady();
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
   * Stop Pluto server
   */
  public async stop(): Promise<void> {
    // Close all workers
    for (const worker of this.workers.values()) {
      await worker.shutdown();
    }
    this.workers.clear();

    // Stop task
    if (this.taskManager.isRunning()) {
      await this.taskManager.stop();
    }

    this.host = undefined;

    // Emit server state changed event
    this.emit("serverStateChanged");
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
    let worker = this.workers.get(notebookPath);

    if (!worker && this.host) {
      // Get notebook content - use provided content or read from file
      let notebookContent: string;
      try {
        if (documentContent) {
          // Use provided VSCode document content
          notebookContent = documentContent;
        } else {
          // Read from file system
          const fileContent = await readFile(notebookPath);
          notebookContent = new TextDecoder().decode(fileContent);
        }

        worker = await this.host.createWorker(notebookContent.trim());
        this.workers.set(notebookPath, worker);

        // Emit notebook opened event
        this.emit("notebookOpened", notebookPath);
      } catch (error) {
        throw new Error(
          `Cannot create worker: failed to read notebook file: ${error}`
        );
      }
    }

    // Ensure worker is connected
    if (worker && !worker.connected) {
      await worker.connect();
    }

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
    return this.taskManager.getActualPort();
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

    // Delete the cell immediately after execution
    await worker.deleteSnippets([result.cell_id]);

    return result;
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
    if (this.taskManager.isRunning()) {
      await this.taskManager.stop().catch(() => {
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

          // Recreate worker
          await this.getWorker(notebook.path);

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
