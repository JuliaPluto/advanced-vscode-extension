import * as vscode from "vscode";
import type { PlutoManager } from "../plutoManager.ts";
import type {
  CellDependencyData,
  NotebookData,
  Worker,
} from "@plutojl/rainbow";

/**
 * Tree item types
 */
enum TreeItemType {
  Notebook = "notebook",
  Cell = "cell",
}

/**
 * Base tree item interface
 */
interface NotebookTreeItemBase extends vscode.TreeItem {
  readonly type: TreeItemType;
  readonly notebookPath: string;
}

/**
 * Tree item for notebook
 */
export class PlutoNotebookTreeItem
  extends vscode.TreeItem
  implements NotebookTreeItemBase
{
  public readonly type = TreeItemType.Notebook;

  constructor(
    public readonly notebookPath: string,
    public readonly plutoNotebook: NotebookData | undefined,
    public readonly isConnected: boolean,
    public readonly error?: Error
  ) {
    // Split on both separators — fsPath uses backslashes on Windows
    const basename = notebookPath.split(/[\\/]/).pop() ?? notebookPath;
    super(basename, vscode.TreeItemCollapsibleState.Expanded);

    // Determine status
    let status = "";
    if (error) {
      status = " (error)";
    } else if (!isConnected) {
      status = " (disconnected)";
    } else if (plutoNotebook) {
      const processStatus = plutoNotebook.process_status || "";
      status = processStatus ? ` (${processStatus})` : " (connected)";
    } else {
      status = " (unknown)";
    }

    this.label = `${basename}${status}`;

    // Assign icon directly based on status
    if (error) {
      this.iconPath = new vscode.ThemeIcon(
        "notebook",
        new vscode.ThemeColor("problemsErrorIcon.foreground")
      );
    } else if (!isConnected) {
      this.iconPath = new vscode.ThemeIcon(
        "notebook",
        new vscode.ThemeColor("problemsWarningIcon.foreground")
      );
    } else if (plutoNotebook) {
      this.iconPath = new vscode.ThemeIcon(
        "notebook",
        new vscode.ThemeColor("charts.green")
      );
    } else {
      this.iconPath = new vscode.ThemeIcon("notebook");
    }

    this.contextValue = "plutoNotebook";
    this.tooltip = notebookPath;
    this.command = {
      command: "pluto-notebook.openNotebookFromTree",
      title: "Open Notebook",
      arguments: [notebookPath],
    };
  }
}

/**
 * Tree item for cell
 */
class PlutoCellTreeItem
  extends vscode.TreeItem
  implements NotebookTreeItemBase
{
  public readonly type = TreeItemType.Cell;

  constructor(
    public readonly notebookPath: string,
    public readonly cellId: string,
    public readonly cellData: ReturnType<Worker["getSnippet"]>,
    public readonly dependencies: CellDependencyData | undefined
  ) {
    const cellResult = cellData?.result;
    const code = cellData?.input?.code ?? "";
    // Dependency data may not exist yet for freshly created cells
    const keys = Object.keys(dependencies?.downstream_cells_map ?? {});
    const upstream = new Set(
      Object.values(dependencies?.upstream_cells_map ?? {})
        .flatMap((x) => x)
        .filter((x) => x !== cellId)
    );
    const treeItemName =
      keys.length > 0
        ? keys.join(", ")
        : code === ""
          ? "(empty)"
          : cellResult?.errored || cellResult?.queued || cellResult?.running
            ? ""
            : cellResult?.output?.mime
              ? "(result)"
              : "";
    super(
      `${" · ".repeat(upstream.size)}${treeItemName}`,
      vscode.TreeItemCollapsibleState.None
    );

    // Assign icon directly based on cell status
    if (cellResult?.running) {
      this.iconPath = new vscode.ThemeIcon(
        "rocket",
        new vscode.ThemeColor("charts.blue")
      );
    } else if (cellResult?.queued) {
      this.iconPath = new vscode.ThemeIcon(
        "clock",
        new vscode.ThemeColor("charts.yellow")
      );
    } else if (cellResult?.errored) {
      this.iconPath = new vscode.ThemeIcon(
        "error",
        new vscode.ThemeColor("problemsErrorIcon.foreground")
      );
    } else if (cellResult?.output) {
      this.iconPath = new vscode.ThemeIcon(
        "pass",
        new vscode.ThemeColor("charts.green")
      );
    } else {
      this.iconPath = new vscode.ThemeIcon("circle-outline");
    }

    this.contextValue = "plutoCell";
    this.tooltip = code
      ? code.length > 100
        ? `${code.substring(0, 100)}...`
        : code
      : cellId;
    this.command = {
      command: "pluto-notebook.focusCellFromTree",
      title: "Focus Cell",
      arguments: [notebookPath, cellId],
    };
  }
}

/**
 * Tree data provider for Pluto notebooks
 */
export class NotebooksTreeDataProvider implements vscode.TreeDataProvider<NotebookTreeItemBase> {
  private readonly _onDidChangeTreeData: vscode.EventEmitter<
    NotebookTreeItemBase | undefined | null | void
  > = new vscode.EventEmitter<NotebookTreeItemBase | undefined | null | void>();
  public readonly onDidChangeTreeData: vscode.Event<
    NotebookTreeItemBase | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Refresh the tree view. Bursts are coalesced — cellUpdated fires for
   * every streaming patch during execution, and rebuilding the whole tree
   * per patch is wasted work.
   */
  public refresh = (): void => {
    this.refreshTimer ??= setTimeout(() => {
      this.refreshTimer = undefined;
      this._onDidChangeTreeData.fire();
    }, 250);
  };

  constructor(private readonly plutoManager: PlutoManager) {
    // Listen to PlutoManager events
    this.plutoManager.on("serverStateChanged", this.refresh);
    this.plutoManager.on("notebookOpened", this.refresh);
    this.plutoManager.on("notebookClosed", this.refresh);
    this.plutoManager.on("cellUpdated", this.refresh);
  }

  /**
   * Get tree item
   */
  public getTreeItem(element: NotebookTreeItemBase): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for tree item
   */
  public async getChildren(
    element?: NotebookTreeItemBase
  ): Promise<NotebookTreeItemBase[]> {
    if (!element) {
      // Root level - show all open notebooks
      return await this.getNotebooks();
    } else if (element.type === TreeItemType.Notebook) {
      // Show cells for this notebook
      return await this.getCells(element.notebookPath);
    }
    return [];
  }

  /**
   * Get all open notebooks
   */
  private async getNotebooks(): Promise<PlutoNotebookTreeItem[]> {
    const notebooks = this.plutoManager.getOpenNotebooks();

    if (notebooks.length === 0) {
      return [];
    }

    return await Promise.all(
      notebooks.map(async (notebook) => {
        let plutoNotebook: NotebookData | undefined;
        let error: Error | undefined;
        const isConnected = this.plutoManager.isConnected();

        try {
          if (isConnected) {
            const worker = await this.plutoManager.getWorker(notebook.path);
            plutoNotebook = worker?.getState();
          }
        } catch (err) {
          error = err instanceof Error ? err : new Error(String(err));
        }

        const item = new PlutoNotebookTreeItem(
          notebook.path,
          plutoNotebook,
          isConnected,
          error
        );

        return item;
      })
    );
  }

  /**
   * Get all cells for a notebook
   */
  private async getCells(notebookPath: string): Promise<PlutoCellTreeItem[]> {
    try {
      const worker = await this.plutoManager.getWorker(notebookPath);
      if (!worker) {
        return [];
      }

      // Get cell order from worker
      const notebookData: NotebookData = worker.getState();
      const cellOrder = notebookData.cell_order;
      if (cellOrder === null || !Array.isArray(cellOrder)) {
        return [];
      }

      if (cellOrder.length === 0) {
        return [];
      }

      const cells: PlutoCellTreeItem[] = [];

      for (const cellId of cellOrder) {
        try {
          const cellData = worker.getSnippet(cellId);
          if (!cellData) {
            continue;
          }
          const cellDependencies = notebookData.cell_dependencies[cellId];
          const item = new PlutoCellTreeItem(
            notebookPath,
            cellId,
            cellData,
            cellDependencies
          );
          cells.push(item);
        } catch (cellError) {
          console.error(
            `[TreeView] Error processing cell ${cellId}:`,
            cellError
          );
        }
      }

      return cells;
    } catch (error) {
      console.error(
        `[TreeView] Failed to get cells for ${notebookPath}:`,
        error
      );
      return [];
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    clearTimeout(this.refreshTimer);
    this.plutoManager.off("serverStateChanged", this.refresh);
    this.plutoManager.off("notebookOpened", this.refresh);
    this.plutoManager.off("notebookClosed", this.refresh);
    this.plutoManager.off("cellUpdated", this.refresh);
  }
}
