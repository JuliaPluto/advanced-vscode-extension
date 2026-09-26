import * as vscode from "vscode";
import type { PlutoManager } from "./plutoManager.ts";

/**
 * Manages the Pluto server status bar item
 */
export class PlutoStatusBar {
  private readonly statusBarItem: vscode.StatusBarItem;

  /**
   * Update the status bar item based on server state
   */
  private readonly update = (): void => {
    const state = this.plutoManager.getState();
    switch (state.status) {
      case "ready":
        this.setRunning(state.url);
        break;
      case "starting":
        this.setBusy("Pluto server is starting...\nClick to cancel");
        break;
      case "stopping":
        this.setBusy("Pluto server is stopping...");
        break;
      case "failed":
        this.setFailed(state.reason);
        break;
      case "stopped":
        this.setStopped();
        break;
    }
  };

  constructor(private readonly plutoManager: PlutoManager) {
    // Create status bar item (aligned to right, priority 100)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    // Set the command to toggle server (start/stop)
    this.statusBarItem.command = "pluto-notebook.toggleServer";

    // Initial update
    this.update();

    this.plutoManager.on("serverStateChanged", this.update);

    // Show the status bar item
    this.statusBarItem.show();
  }

  private setRunning(url: string): void {
    this.statusBarItem.text = "$(check) Pluto";
    this.statusBarItem.tooltip = `Pluto server is running on ${url}\nClick to stop`;
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.color = new vscode.ThemeColor(
      "statusBarItem.prominentForeground"
    );
  }
  private setBusy(tooltip: string): void {
    this.statusBarItem.text = "$(sync~spin) Pluto";
    this.statusBarItem.tooltip = tooltip;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    this.statusBarItem.color = undefined;
  }
  private setFailed(reason: string): void {
    this.statusBarItem.text = "$(error) Pluto";
    this.statusBarItem.tooltip = `Pluto server failed: ${reason}\nClick to start`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
    this.statusBarItem.color = undefined;
  }
  private setStopped(): void {
    this.statusBarItem.text = "$(debug-stop) Pluto";
    this.statusBarItem.tooltip = "Pluto server is stopped\nClick to start";
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.color = new vscode.ThemeColor(
      "statusBarItem.foreground"
    );
  }
  /**
   * Force an immediate update of the status bar
   */
  public refresh(): void {
    this.update();
  }

  /**
   * Dispose of the status bar item and cleanup
   */
  public dispose(): void {
    this.plutoManager.off("serverStateChanged", this.update);
    this.statusBarItem.dispose();
  }
}
