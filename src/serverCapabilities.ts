/** Either the server can do it, or the reason it cannot, stated once. */
export type Capability = { ok: true } | { ok: false; reason: string };

export type FileSync =
  "server-writes-file" | "editor-writes-file" | "server-holds-copy";

export interface ServerCapabilities {
  /** Who keeps the user's notebook file up to date while it is open. */
  fileSync: FileSync;
  /** Move the notebook, and its .assets, to another path on the user's disk. */
  moveNotebook: Capability;
  /** Have the server write a file that this process then reads. */
  writeLocalFile: Capability;
}

const OK: Capability = { ok: true };

/**
 * What a Pluto server can do for this process. Writing notebook files only
 * reaches the user's disk when the server shares this machine's filesystem.
 */
export function serverCapabilities(server: {
  sharesFilesystem: boolean;
  writesNotebookFiles: boolean;
}): ServerCapabilities {
  if (!server.sharesFilesystem) {
    return {
      fileSync: "server-holds-copy",
      moveNotebook: {
        ok: false,
        reason:
          "Moving a notebook only works when the Pluto server is on localhost (it shares this machine's filesystem). Use save_notebook to write a copy instead.",
      },
      writeLocalFile: {
        ok: false,
        reason:
          "Rendering to a file needs a Pluto server on localhost (it shares this machine's filesystem).",
      },
    };
  }
  return {
    fileSync: server.writesNotebookFiles
      ? "server-writes-file"
      : "editor-writes-file",
    moveNotebook: OK,
    writeLocalFile: OK,
  };
}

export function requireCapability(capability: Capability): void {
  if (!capability.ok) {
    throw new Error(capability.reason);
  }
}

export function describeFileSync(fileSync: FileSync): string {
  switch (fileSync) {
    case "server-writes-file":
      return "Pluto is tracking this file path and will save changes to it.";
    case "editor-writes-file":
      return "The server does not write this file: changes reach disk when the notebook is saved in the editor, or through save_notebook.";
    case "server-holds-copy":
      return "Warning: Pluto server is remote — the file on disk is NOT synced with the server. Use save_notebook to write changes back to the local file.";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** Whether a server URL points at this machine. */
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
