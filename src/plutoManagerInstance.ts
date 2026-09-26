import type { PlutoManagerLogger } from "./plutoManager.ts";
import { PlutoManager } from "./plutoManager.ts";
import * as vscode from "vscode";
import {
  VscodeTaskLauncher,
  resolveExtensionToolchain,
} from "./plutoServerTask.ts";
import { PlutoServer } from "./server/plutoServer.ts";
import { VscodeFileReader } from "./vscodeFileReader.ts";

/**
 * Shared PlutoManager instance that can be used by both the extension and MCP server
 * This ensures they use the same Pluto server connection and worker sessions
 */
let sharedPlutoManager: PlutoManager | undefined;

export function getSharedPlutoManager(
  port: number,
  logger: PlutoManagerLogger,
  serverUrl?: string
): PlutoManager {
  sharedPlutoManager ??= new PlutoManager(
    port,
    logger,
    new PlutoServer(
      new VscodeTaskLauncher(),
      resolveExtensionToolchain,
      // The editor is the only writer of notebook files, so a save in VS
      // Code never races a write from Pluto
      { port, writeNotebookFiles: false, update: true },
      { warn: (message) => void vscode.window.showWarningMessage(message) }
    ),
    new VscodeFileReader(),
    serverUrl
  );
  return sharedPlutoManager;
}

export function clearSharedPlutoManager(): void {
  sharedPlutoManager = undefined;
}
