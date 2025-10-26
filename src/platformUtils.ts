/**
 * Platform detection and platform-specific utilities
 */

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Get platform-specific executable name
 */
export function getExecutableName(baseName: string): string {
  return isWindows() ? `${baseName}.exe` : baseName;
}

/**
 * Escape a Julia code string for shell execution
 * On Windows, ShellExecution requires special handling of quotes
 */
export function escapeJuliaCode(code: string): string {
  if (isWindows()) {
    // On Windows, we need to escape double quotes inside the Julia code
    // by replacing them with \"
    return code.replace(/"/g, '\\"');
  }
  // On Unix-like systems, the shell handles quotes correctly
  return code;
}
