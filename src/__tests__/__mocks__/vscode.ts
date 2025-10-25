// Mock vscode module for Jest tests
// Only includes what's actually used by the tests

import { join } from "path";

// Notebook-related types (for serializer tests)
export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export class NotebookCellData {
  constructor(
    public kind: NotebookCellKind,
    public value: string,
    public languageId: string
  ) {}
}

export class NotebookData {
  constructor(public cells: NotebookCellData[]) {}
}

export class NotebookCellOutputItem {
  public static json(data: unknown, mime?: string): NotebookCellOutputItem {
    return new NotebookCellOutputItem(
      JSON.stringify(data),
      mime ?? "application/json"
    );
  }

  constructor(
    public data: string,
    public mime: string
  ) {}
}

export class NotebookCellOutput {
  constructor(public items: NotebookCellOutputItem[]) {}
}

// Workspace (used by PlutoServerTaskManager and PlutoManager)
export const workspace = {
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: unknown) => {
      if (section === "julia" || !section) {
        if (key === "executablePath") return "julia";
        if (key === "environmentPath") return "";
      }
      return defaultValue;
    },
  }),
  fs: {
    readFile: async (uri: { fsPath: string }): Promise<Uint8Array> => {
      const { readFile } = await import("fs/promises");
      return await readFile(uri.fsPath);
    },
    writeFile: async (
      uri: { fsPath: string },
      content: Uint8Array
    ): Promise<void> => {
      const { writeFile } = await import("fs/promises");
      await writeFile(uri.fsPath, content);
    },
    delete: async (uri: { fsPath: string }): Promise<void> => {
      const { unlink } = await import("fs/promises");
      await unlink(uri.fsPath);
    },
    stat: async (uri: { fsPath: string }): Promise<{ type: number }> => {
      const { stat } = await import("fs/promises");
      const stats = await stat(uri.fsPath);
      return { type: stats.isDirectory() ? 2 : 1 };
    },
    createDirectory: async (uri: { fsPath: string }): Promise<void> => {
      const { mkdir } = await import("fs/promises");
      await mkdir(uri.fsPath, { recursive: true });
    },
    readDirectory: async (uri: {
      fsPath: string;
    }): Promise<Array<[string, number]>> => {
      const { readdir } = await import("fs/promises");
      const entries = await readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]);
    },
  },
};

// Task-related types (used by PlutoServerTaskManager)
export enum TaskScope {
  Global = 1,
  Workspace = 2,
}

export enum TaskRevealKind {
  Always = 1,
  Silent = 2,
  Never = 3,
}

export enum TaskPanelKind {
  Shared = 1,
  Dedicated = 2,
  New = 3,
}

export class TaskExecution {
  constructor(public task: Task) {}
  terminate() {}
}

export class ShellExecution {
  constructor(
    public command: string,
    public args?: string[],
    public options?: Record<string, unknown>
  ) {}
}

export interface TaskDefinition {
  type: string;
  [key: string]: unknown;
}

export interface TaskPresentationOptions {
  reveal?: TaskRevealKind;
  panel?: TaskPanelKind;
  showReuseMessage?: boolean;
  clear?: boolean;
  focus?: boolean;
  echo?: boolean;
}

export class Task {
  public presentationOptions?: TaskPresentationOptions;
  public isBackground: boolean = false;

  constructor(
    public definition: TaskDefinition,
    public scope: TaskScope | { uri: unknown; name?: string },
    public name: string,
    public source: string,
    public execution: ShellExecution,
    public problemMatchers?: string[]
  ) {}
}

// Tasks namespace (used by PlutoServerTaskManager)
const taskEndListeners: Array<(e: { execution: TaskExecution }) => void> = [];

export const tasks = {
  executeTask: async (task: Task): Promise<TaskExecution> =>
    await Promise.resolve(new TaskExecution(task)),
  onDidEndTaskProcess: (
    listener: (e: { execution: TaskExecution }) => void
  ) => {
    taskEndListeners.push(listener);
    return {
      dispose: () => {
        const index = taskEndListeners.indexOf(listener);
        if (index > -1) {
          taskEndListeners.splice(index, 1);
        }
      },
    };
  },
  taskExecutions: [] as TaskExecution[],
};

// Disposable interface
export interface Disposable {
  dispose(): void;
}

// Uri (for general use)
export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => path }),
  parse: (uri: string) => ({ fsPath: uri, toString: () => uri }),
  joinPath: (base: { fsPath: string }, ...pathSegments: string[]) => {
    const joined = join(base.fsPath, ...pathSegments);
    return { fsPath: joined, toString: () => joined };
  },
};
