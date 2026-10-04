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
 * the default depot in the user's home directory followed by an empty
 * entry, which Julia expands to the depots bundled with the Julia
 * install. Those bundled depots hold artifacts that some distributions
 * (e.g. Dyad's Julia) load from their system image at startup.
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

  return path.join(os.homedir(), ".julia") + separator;
}

/**
 * Get platform-specific executable name
 */
export function getExecutableName(baseName: string): string {
  return isWindows() ? `${baseName}.exe` : baseName;
}

/**
 * Whether a resolved Julia command line runs the given juliaup channel.
 * juliaup names install directories with the channel's dots replaced by
 * `x` (`dyad-3.3.0` lives in `julia-1.12.7+dyad-3x3x0.…`), so the channel
 * matches either as a `+channel` argument or under its directory spelling.
 */
export function commandUsesJuliaupChannel(
  channel: string,
  command: string
): boolean {
  const directoryForm = channel.replace(/\./g, "x");
  return (
    command.includes(`+${channel}`) || command.includes(`+${directoryForm}.`)
  );
}
