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
