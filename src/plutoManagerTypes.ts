/**
 * Abstraction for starting/stopping the Pluto server process.
 * VSCode uses PlutoServerTaskManager (vscode.Task-based).
 * The CLI uses NodeServerManager (child_process-based).
 */
export interface IPlutoServerManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  waitForReady(): Promise<void>;
  onStop(callback: () => void): void;
  onPortChanged(callback: (newPort: number) => void): void;
  getActualPort(): number;
  getServerUrl(): string;
}

/**
 * Abstraction for reading a file by its filesystem path.
 * VSCode uses vscode.workspace.fs; the CLI uses fs/promises.
 */
export interface IFileReader {
  readFile(path: string): Promise<string>;
}
