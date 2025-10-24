import type { PlutoManagerLogger } from "./plutoManager.ts";
import { PlutoManager } from "./plutoManager.ts";

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
  sharedPlutoManager ??= new PlutoManager(port, logger, serverUrl);
  return sharedPlutoManager;
}

export function clearSharedPlutoManager(): void {
  sharedPlutoManager = undefined;
}
