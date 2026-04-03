import * as vscode from "vscode";
import { getExecutableName } from "./platformUtils.ts";

// ---------------------------------------------------------------------------
// Julia extension API types
// ---------------------------------------------------------------------------

interface JuliaChannelInfo {
  name: string;
  file: string;
  args: string[];
  version: string;
  arch: string;
  isDefault: boolean;
}

interface JuliaExecutableInfo {
  /** Resolved command path (new API) */
  command: string;
  /** Resolved command path (old API, backward compat) */
  file?: string;
  version: string;
  args: string[];
  channel: JuliaChannelInfo;
}

interface JuliaExtAPI {
  version: number;
  getJuliaExecutable: () => Promise<JuliaExecutableInfo>;
  getEnvironment: () => Promise<string>;
  getPkgServer: () => string;
  installJuliaOrJuliaup: (
    taskName: string,
    customCommand?: string
  ) => Promise<number | void>;
}

// ---------------------------------------------------------------------------
// JuliaHub auth extension API types
// ---------------------------------------------------------------------------

interface JuliaHubAuthAPI {
  version: number;
  getJuliaHubServer: () => string;
  onDidChangeServer: vscode.Event<string>;
  authenticate: (server?: string, force?: boolean) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Julia extension helpers
// ---------------------------------------------------------------------------

function getJuliaAPI(): vscode.Extension<JuliaExtAPI> | undefined {
  return vscode.extensions.getExtension<JuliaExtAPI>(
    "julialang.language-julia"
  );
}

export async function activateJulia(): Promise<vscode.Extension<JuliaExtAPI>> {
  const api = getJuliaAPI();
  if (!api)
    throw new Error(
      "Julia language extension (julialang.language-julia) not found"
    );
  if (!api.isActive) await api.activate();
  return api;
}

/**
 * Returns the Julia executable command and any channel args (e.g. `+1.11.7`)
 * from the active Julia extension configuration.
 *
 * Falls back to `julia.executablePath` workspace config, then to the plain
 * `julia` / `julia.exe` executable name if the extension API is unavailable.
 */
export async function getJuliaExecutable(): Promise<{
  command: string;
  args: string[];
}> {
  try {
    const api = await activateJulia();
    const exe = await api.exports.getJuliaExecutable();
    const command = exe?.command ?? exe?.file ?? getFallbackJuliaCommand();
    return { command, args: exe?.args ?? [] };
  } catch (err) {
    console.warn(
      "[julia-utils] Could not get Julia executable from extension, falling back:",
      err
    );
    return { command: getFallbackJuliaCommand(), args: [] };
  }
}

function getFallbackJuliaCommand(): string {
  return (
    vscode.workspace.getConfiguration("julia").get<string>("executablePath") ??
    getExecutableName("julia")
  );
}

/**
 * Returns the active Julia package server URL from the Julia extension.
 * Falls back to `julia.packageServer` workspace config, then undefined.
 */
export async function getPackageServer(): Promise<string | undefined> {
  try {
    const api = await activateJulia();
    const server = api.exports.getPkgServer();
    return server || undefined;
  } catch {
    return (
      vscode.workspace.getConfiguration("julia").get<string>("packageServer") ||
      undefined
    );
  }
}

/**
 * Runs a Julia package manager command via the Julia extension's integrated
 * REPL (`language-julia.runPackageCommand`). This respects the active Julia
 * channel and depot without requiring subprocess management.
 *
 * Adopted from https://github.dev/julia-vscode/julia-vscode
 */
export async function runPackageCommand(
  command: string,
  workspace: string
): Promise<void> {
  await activateJulia();
  await vscode.commands.executeCommand(
    "language-julia.runPackageCommand",
    command,
    workspace
  );
}

// ---------------------------------------------------------------------------
// JuliaHub auth extension helpers
// ---------------------------------------------------------------------------

/**
 * Retrieves a JuliaHub authentication token via the
 * `JuliaComputing.juliahub-vscode-auth` extension.
 *
 * Throws if the extension is not installed or authentication fails.
 * The extension is listed in `extensionDependencies` so it is guaranteed
 * to be present at activation time.
 */
export async function getJuliaHubToken(hostname?: string): Promise<string> {
  const ext = vscode.extensions.getExtension<JuliaHubAuthAPI>(
    "JuliaComputing.juliahub-vscode-auth"
  );
  if (!ext) {
    throw new Error(
      "JuliaHub auth extension (JuliaComputing.juliahub-vscode-auth) not found"
    );
  }
  if (!ext.isActive) await ext.activate();
  const server = hostname ? `https://${hostname}` : undefined;
  return await ext.exports.authenticate(server);
}
