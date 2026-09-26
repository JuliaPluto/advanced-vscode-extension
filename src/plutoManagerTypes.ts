/**
 * Abstraction for starting/stopping the Pluto server process.
 * VSCode uses PlutoServerTaskManager (vscode.Task-based).
 * The CLI uses NodeServerManager (child_process-based).
 */
export interface IPlutoServerManager {
  /** Launch the server, or wait for the one this manager already runs. */
  start(): Promise<void>;
  /** Stop the server; a no-op when none is running. */
  stop(): Promise<void>;
  waitForReady(): Promise<void>;
  /** Called when the server process exits, whatever the cause. */
  onStop(callback: () => void): void;
  onPortChanged(callback: (newPort: number) => void): void;
  getActualPort(): number;
  getServerUrl(): string;
  /**
   * Whether the server writes notebook files itself after every run.
   * Absent means Pluto's default, which is to write them.
   */
  writesNotebookFiles?(): boolean;
}

/**
 * Abstraction for reading a file by its filesystem path.
 * VSCode uses vscode.workspace.fs; the CLI uses fs/promises.
 */
export interface IFileReader {
  readFile(path: string): Promise<string>;
}

/**
 * The server process PlutoManager owns. `start` resolves with the URL once
 * the server answers; `onExit` reports exits the server did not ask for.
 */
export interface IPlutoServer {
  start(signal?: AbortSignal): Promise<string>;
  stop(): Promise<void>;
  onExit(listener: () => void): void;
  readonly writesNotebookFiles: boolean;
}
