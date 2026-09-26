import * as vscode from "vscode";
import type { PlutoManager } from "../plutoManager.ts";
import { NotebooksTreeDataProvider } from "./notebooksTreeDataProvider.ts";

export function registerNotebooksTreeView(
  context: vscode.ExtensionContext,
  plutoManager: PlutoManager
): NotebooksTreeDataProvider {
  // Create tree data provider
  const treeDataProvider = new NotebooksTreeDataProvider(plutoManager);

  // Register tree view
  const treeView = vscode.window.createTreeView("plutoNotebooks", {
    treeDataProvider,
    showCollapseAll: true,
  });

  // Add to subscriptions
  context.subscriptions.push(treeView);
  context.subscriptions.push(treeDataProvider);
  return treeDataProvider;
}
