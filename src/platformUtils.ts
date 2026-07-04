/**
 * Platform detection and platform-specific utilities
 */

import * as os from "os";
import * as path from "path";

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Resolve the JULIA_DEPOT_PATH to pass to spawned Julia processes.
 * Julia requires absolute depot entries — a literal "~" is treated as a
 * relative directory named "~" (issue #34). Respects an existing
 * absolute setting, expands "~"-prefixed entries, and falls back to
 * the default depot in the user's home directory.
 */
export function resolveJuliaDepotPath(): string {
  const separator = isWindows() ? ";" : ":";
  const existing = process.env.JULIA_DEPOT_PATH;

  if (existing?.trim()) {
    const expanded = existing
      .split(separator)
      .map((entry) =>
        entry.startsWith("~") ? path.join(os.homedir(), entry.slice(1)) : entry
      )
      .join(separator);
    const first = expanded.split(separator)[0];
    if (first && path.isAbsolute(first)) {
      return expanded;
    }
  }

  return path.join(os.homedir(), ".julia");
}

/**
 * Get platform-specific executable name
 */
export function getExecutableName(baseName: string): string {
  return isWindows() ? `${baseName}.exe` : baseName;
}

/**
 * Convert a file path to use forward slashes for Julia code
 * Julia accepts forward slashes on all platforms, including Windows
 * This avoids backslash escaping issues in shell commands
 */
export function toJuliaPath(path: string): string {
  // Replace all backslashes with forward slashes
  return path.replace(/\\/g, "/");
}

/**
 * Escape a Julia code string for shell execution
 * On Windows PowerShell, VSCode wraps the -e argument in single quotes,
 * so double quotes inside don't need escaping, but single quotes do.
 */
export function escapeJuliaCode(code: string): string {
  if (isWindows()) {
    // On Windows PowerShell, VSCode wraps the -e argument in single quotes.
    // Inside PowerShell single quotes, we need to escape single quotes by doubling them
    // Double quotes are treated literally and don't need escaping
    return code.replace(/'/g, "''");
  }
  // On Unix-like systems, the shell handles quotes correctly
  return code;
}
