import type { CellResultData, Worker } from "@plutojl/rainbow";
import { Host, parse } from "@plutojl/rainbow";
import * as path from "path";
import { rm, writeFile } from "fs/promises";
import type { IPlutoServerManager, IFileReader } from "./plutoManagerTypes.ts";
import { EventEmitter } from "events";
import { resolve as resolvePath } from "path";
import { v4 as uuidv4 } from "uuid";

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
  private readonly adoptedWorkers: Set<string> = new Set(); // paths of notebooks we attached to but don't own (e.g. open in the user's browser)
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
    for (const [notebookPath, worker] of this.workers.entries()) {
      void this.releaseWorker(notebookPath, worker).catch(() => {});
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
   * Whether a start() is currently in flight.
   */
  public isStarting(): boolean {
    return !!this.startPromise;
  }

  /**
   * Start Pluto server (or connect to custom server URL).
   * Concurrent callers share one in-flight start. State events fire when
   * the start begins and when it settles (success or failure), so UI like
   * the status bar can show a "starting" phase.
   */
  public async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart().finally(() => {
        this.startPromise = undefined;
        this.emit("serverStateChanged");
      });
      this.emit("serverStateChanged");
    }
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
        [...this.workers.entries()].map(([notebookPath, worker]) =>
          this.releaseWorker(notebookPath, worker).catch(() => {
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
   * @param documentContent - Notebook content to upload instead of reading the file; only used for remote servers (a local server opens the file in place)
   * @returns Worker instance for the notebook
   */
  public async getWorker(
    notebookPath: string,
    documentContent?: string
  ): Promise<Worker | undefined> {
    if (!path.isAbsolute(notebookPath)) {
      throw new Error(
        `Notebook paths must be absolute — Pluto identifies a notebook by its absolute path and cannot resolve '${notebookPath}' against your working directory. Pass the full path.`
      );
    }
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

  /**
   * Release a worker: shut down the notebook if we own it, otherwise just
   * close our connection — adopted notebooks (open in the user's browser)
   * must keep running.
   */
  private async releaseWorker(
    notebookPath: string,
    worker: Worker
  ): Promise<void> {
    if (this.adoptedWorkers.has(notebookPath)) {
      this.adoptedWorkers.delete(notebookPath);
      try {
        worker.close();
      } catch {
        // Connection may already be gone
      }
      return;
    }
    await worker.shutdown();
  }

  /**
   * Find a notebook already running on the server for this file path.
   * Returns its notebook_id, or undefined when none matches or the
   * listing fails.
   */
  private async findRunningNotebook(
    host: Host,
    notebookPath: string
  ): Promise<string | undefined> {
    try {
      const running = (await host.workers()) as unknown as Array<{
        notebook_id?: string;
        path?: string;
      }>;
      const target = resolvePath(notebookPath);
      return running.find(
        (nb) => nb.notebook_id && nb.path && resolvePath(nb.path) === target
      )?.notebook_id;
    } catch {
      return undefined;
    }
  }

  /**
   * Ask Pluto to open a notebook file in place (POST /open) and return the
   * notebook id. Pluto starts running it, and answers with the existing
   * notebook when the path is already open on the server.
   */
  private async openByPath(notebookPath: string): Promise<string> {
    const url = new URL("/open", this.serverUrl);
    url.searchParams.set("path", notebookPath);
    url.searchParams.set("execution_allowed", "true");

    let response: Response;
    try {
      response = await fetch(url, { method: "POST" });
    } catch (error) {
      throw new Error(this.describeServerError(error));
    }
    const body = (await response.text()).trim();
    if (!response.ok) {
      // Pluto answers failures with an HTML page: title, advice, then the
      // Julia error under "Error message:" — that line is the useful one
      const text = body
        .replace(/<!--[\s\S]*?-->|<(style|script)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const reason = (text.match(/Error message: (.*)$/)?.[1] ?? text)
        .split(/ Stacktrace:| @ /)[0]
        .slice(0, 300);
      throw new Error(
        this.describeServerError(
          new Error(
            `Pluto could not open ${notebookPath} (HTTP ${response.status}): ${reason}`
          )
        )
      );
    }
    if (!/^[0-9a-f-]{36}$/i.test(body)) {
      throw new Error(
        `Pluto returned an unexpected answer when opening ${notebookPath}: ${body.slice(0, 120)}`
      );
    }
    return body;
  }

  private async createWorkerForPath(
    notebookPath: string,
    documentContent?: string
  ): Promise<Worker> {
    const host = this.host;
    if (!host) {
      throw new Error("Cannot create worker: not connected to Pluto server");
    }

    // If the server already manages this file (e.g. the user's own browser
    // tab has it open), adopt that notebook — uploading a copy and calling
    // moveTo would fail with "File exists already" (issue #40)
    if (this.isLocalServer()) {
      const runningId = await this.findRunningNotebook(host, notebookPath);
      if (runningId) {
        const worker = host.worker(runningId);
        try {
          await worker.connect();

          // A notebook opened but never granted execution (Pluto's safe
          // preview, "waiting_for_permission") silently ignores run
          // requests — grant permission like createWorker's init does.
          // A notebook with a live session is left untouched.
          if (
            worker.notebook_state?.process_status === "waiting_for_permission"
          ) {
            await worker.restart();
          }

          if (this.stopping || this.host !== host) {
            throw new Error(
              "Pluto server was stopped while opening the notebook"
            );
          }
        } catch (error) {
          // Do NOT shut the notebook down — we don't own it (it may be
          // open in the user's browser)
          throw new Error(this.describeServerError(error));
        }
        this.workers.set(notebookPath, worker);
        this.adoptedWorkers.add(notebookPath);
        this.emit("notebookOpened", notebookPath);
        return worker;
      }
    }

    let worker: Worker;
    if (this.isLocalServer()) {
      // Same filesystem: let Pluto load the file where it is. Nothing is
      // copied or deleted, and the file stays a plain Pluto notebook that
      // both Pluto and VS Code write to.
      const notebookId = await this.openByPath(notebookPath);
      worker = host.worker(notebookId);
    } else {
      // Remote server: the file has to travel — upload the content (the
      // VS Code document when given, else the file) as a new notebook.
      let notebookContent: string;
      try {
        notebookContent =
          documentContent ?? (await this.fileReader.readFile(notebookPath));
      } catch (error) {
        throw new Error(
          `Cannot create worker: failed to read notebook file: ${error}`
        );
      }
      try {
        worker = await host.createWorker(notebookContent.trim());
      } catch (error) {
        throw new Error(this.describeServerError(error));
      }
    }

    try {
      if (!(await worker.connect())) {
        throw new Error("could not connect to the notebook session");
      }

      // The server may have been stopped (or replaced) while we were
      // connecting — registering the worker now would leak it into a
      // manager whose stop() has already run
      if (this.stopping || this.host !== host) {
        throw new Error("Pluto server was stopped while opening the notebook");
      }
    } catch (error) {
      // Don't leak the worker if connect failed
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
  /**
   * Send a cell's new code to Pluto without running it. The worker's own
   * updateSnippetCode(run=false) only records the code locally, which
   * neither save_notebook nor a later run would see.
   */
  public async setCellCode(
    worker: Worker,
    cellId: string,
    code: string
  ): Promise<void> {
    await this.updateNotebookState(worker, (nb) => {
      const input = nb.cell_inputs[cellId];
      if (!input) {
        throw new Error(`Cell ${cellId} not found`);
      }
      input.code = code;
    });
  }

  /** Run a cell with whatever code Pluto currently holds for it, and wait for the result. */
  public async runCell(
    worker: Worker,
    cellId: string
  ): Promise<CellResultData | null> {
    if (!worker.client) {
      throw new Error("Not connected to notebook");
    }
    const before =
      worker.getSnippet(cellId)?.result.output?.last_run_timestamp ?? 0;
    await worker.client.send(
      "run_multiple_cells",
      { cells: [cellId] },
      { notebook_id: worker.notebook_id }
    );
    return await this.waitForCellRun(worker, cellId, before);
  }

  /** Replace a cell's code, run it, and return the result of that run. */
  public async executeCell(
    worker: Worker,
    cellId: string,
    code: string
  ): Promise<CellResultData | null> {
    await this.setCellCode(worker, cellId, code);
    return await this.runCell(worker, cellId);
  }

  /**
   * Mutate the worker's notebook state through its own updater, which
   * diffs the change, sends it to Pluto, and keeps the local copy in sync.
   */
  private async updateNotebookState(
    worker: Worker,
    mutate: (nb: {
      cell_inputs: Record<
        string,
        { code: string; code_folded: boolean; [key: string]: unknown }
      >;
    }) => void
  ): Promise<void> {
    if (!worker.client || !worker.notebook_state) {
      throw new Error("Not connected to notebook");
    }
    await (
      worker as unknown as {
        _update_notebook_state: (fn: typeof mutate) => Promise<void>;
      }
    )._update_notebook_state(mutate);
  }

  /**
   * Wait until a cell has run since `before`. Pluto may decide not to run
   * a cell at all (e.g. a parse error), so give it a few seconds to pick
   * the cell up before returning whatever result it holds.
   */
  private async waitForCellRun(
    worker: Worker,
    cellId: string,
    before: number,
    limitMs = 60 * 60_000
  ): Promise<CellResultData | null> {
    const start = Date.now();
    const pickupDeadline = start + 5_000;
    let seenBusy = false;
    while (Date.now() - start < limitMs) {
      const result = worker.getSnippet(cellId)?.result;
      if (!result) {
        return null;
      }
      const busy = result.running || result.queued;
      seenBusy ||= busy;
      const stamp = result.output?.last_run_timestamp ?? 0;
      if (!busy && stamp > before) {
        return result;
      }
      if (!busy && !seenBusy && Date.now() > pickupDeadline) {
        return result;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("Timed out waiting for cell execution to finish");
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
    code: string,
    cellId?: string
  ): Promise<string> {
    return await worker.addSnippet(index, code, {}, cellId);
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
      return;
    }

    await this.updateNotebookState(worker, (nb) => {
      nb.cell_inputs[cellId].code_folded = folded;
    });
  }

  /**
   * Move a notebook to a new file path via Pluto (updates Pluto's tracked path
   * and moves the .assets directory). A server that does not write notebook
   * files leaves the file itself to us: write the new path, remove the old.
   */
  public async moveNotebook(worker: Worker, newPath: string): Promise<void> {
    const oldPath = worker.getState()?.path;
    await worker.moveTo(newPath);
    if (this.serverWritesNotebookFiles()) {
      return;
    }
    await writeFile(newPath, await this.fetchNotebookFile(worker), "utf-8");
    if (oldPath && resolvePath(oldPath) !== resolvePath(newPath)) {
      await rm(oldPath, { force: true });
    }
  }

  /**
   * Whether the Pluto server writes notebook files after every run. When it
   * does not, only the editor's save and save_notebook reach the disk.
   */
  public serverWritesNotebookFiles(): boolean {
    return this.serverManager.writesNotebookFiles?.() ?? true;
  }

  /**
   * The notebook as Pluto would write it (GET /notebookfile): cells, order,
   * folds and the embedded package environment, straight from the server's
   * memory. The only source of the current Project/Manifest text.
   */
  public async fetchNotebookFile(worker: Worker): Promise<string> {
    const url = new URL("/notebookfile", this.serverUrl);
    url.searchParams.set("id", worker.notebook_id);
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(this.describeServerError(error));
    }
    if (!response.ok) {
      throw new Error(
        this.describeServerError(
          new Error(
            `Pluto could not serialize notebook ${worker.notebook_id} (HTTP ${response.status})`
          )
        )
      );
    }
    return await response.text();
  }

  /**
   * The embedded package environment cells of an open notebook, as Pluto
   * holds them now; undefined when the notebook is not open on this server.
   */
  public async getPackageCells(
    notebookId: string
  ): Promise<Record<string, string> | undefined> {
    const worker = [...this.workers.values()].find(
      (w) => w.notebook_id === notebookId
    );
    if (!worker || !this.host) {
      return undefined;
    }
    const parsed = parse(await this.fetchNotebookFile(worker)) as
      { _package_cells?: Record<string, string> } | undefined;
    const cells = parsed?._package_cells;
    return cells && Object.keys(cells).length > 0 ? cells : undefined;
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
      void this.releaseWorker(notebookPath, worker).catch(() => {});
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
   * Create a cell, run it, and resolve with its result — robust against
   * rainbow's waitSnippet missing the terminal update of fast cells (its
   * listener registers after addSnippet's round trip, by which time a
   * trivial cell may already be done; with no further update traffic the
   * promise then never settles). A state poll acts as the fallback.
   */
  public async runSnippet(
    worker: Worker,
    index: number,
    code: string
  ): Promise<CellResultData> {
    const limitMs = 60 * 60_000;
    const cellId = uuidv4();

    const viaEvents: Promise<CellResultData> = worker
      .waitSnippet(index, code, {}, cellId, limitMs)
      // On timeout waitSnippet rejects with null — let the poll decide
      .catch(() => new Promise<never>(() => {}));

    let stopPolling = false;
    const viaPolling = (async (): Promise<CellResultData> => {
      const deadline = Date.now() + limitMs;
      while (!stopPolling && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        const result = worker.getSnippet(cellId)?.result;
        if (
          result &&
          !result.running &&
          !result.queued &&
          (result.output?.last_run_timestamp ?? 0) > 0
        ) {
          return result;
        }
      }
      throw new Error("Timed out waiting for cell execution to finish");
    })();

    try {
      return await Promise.race([viaEvents, viaPolling]);
    } finally {
      stopPolling = true;
    }
  }

  /**
   * Execute Julia code in a notebook without creating a persistent cell
   * This uses runSnippet at index 0 and then immediately deletes the cell
   */
  public async executeCodeEphemeral(
    worker: Worker,
    code: string
  ): Promise<CellResultData> {
    // Execute code at index 0 (creates a temporary cell)
    const result = await this.runSnippet(worker, 0, code);

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
  public async getNotebookContent(worker: Worker): Promise<string> {
    return await this.fetchNotebookFile(worker);
  }

  /**
   * Close all notebook connections
   */
  public async dispose(): Promise<void> {
    for (const [notebookPath, worker] of this.workers.entries()) {
      await this.releaseWorker(notebookPath, worker).catch(() => {});
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
