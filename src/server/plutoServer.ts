import type { IPlutoServer } from "../plutoManagerTypes.ts";
import { findAvailablePort, isPortAvailable } from "../portUtils.ts";
import { isWindows, resolveJuliaDepotPath } from "../platformUtils.ts";
import { plutoBootstrap } from "./bootstrap.ts";
import type { LaunchedProcess, ProcessLauncher } from "./launcher.ts";

/** Which Julia to run and with what credentials; resolved per host. */
export interface JuliaToolchain {
  command: string;
  /** Arguments before the program, e.g. a juliaup channel. */
  args: string[];
  packageServer?: string;
  juliaHubToken?: string;
  /** Passed to the server as JULIA_PLUTO_VSCODE_WORKSPACE. */
  workspaceDir?: string;
  /** Host-specific environment additions. */
  env?: Record<string, string>;
}

export interface PlutoServerOptions {
  /** Preferred port; the next free one is used when it is taken. */
  port: number;
  /** Whether Pluto writes notebook files after every run. */
  writeNotebookFiles: boolean;
  /** Re-resolve and precompile Pluto on every start. */
  update: boolean;
  readiness?: { timeoutMs: number; intervalMs: number };
  stopTimeoutMs?: number;
}

export interface PlutoServerLog {
  warn(message: string): void;
}

const DEFAULT_READINESS = { timeoutMs: 600_000, intervalMs: 1000 };
const DEFAULT_STOP_TIMEOUT_MS = 5000;
const PROBE_TIMEOUT_MS = 2000;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A Pluto server process owned by this session: port selection, the
 * bootstrap program, its environment, readiness and a bounded stop. A
 * server adopted from an earlier session is waited for and stopped
 * exactly like one launched here.
 */
export class PlutoServer implements IPlutoServer {
  public readonly writesNotebookFiles: boolean;
  private process?: LaunchedProcess;
  private url?: string;
  private starting?: Promise<string>;
  private readonly exitListeners: Array<() => void> = [];

  constructor(
    private readonly launcher: ProcessLauncher,
    private readonly resolveToolchain: () => Promise<JuliaToolchain>,
    private readonly options: PlutoServerOptions,
    private readonly log: PlutoServerLog
  ) {
    this.writesNotebookFiles = options.writeNotebookFiles;
  }

  /**
   * Resolves with the server URL once it answers HTTP. Concurrent callers
   * share one start; the signal cancels it and terminates the process.
   */
  public start(signal?: AbortSignal): Promise<string> {
    if (this.process && this.url) {
      return Promise.resolve(this.url);
    }
    this.starting ??= this.launchAndWait(signal).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Graceful, then killed after the stop budget; a no-op when none runs. */
  public async stop(): Promise<void> {
    const process = this.process;
    if (!process) {
      return;
    }
    this.process = undefined;
    this.url = undefined;
    await this.terminate(process);
  }

  /** Exits this server did not ask for. */
  public onExit(listener: () => void): void {
    this.exitListeners.push(listener);
  }

  private async launchAndWait(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const adopted = await this.launcher.adopt?.();
    let process: LaunchedProcess;
    let port: number;
    if (adopted) {
      ({ process, port } = adopted);
    } else {
      port = await this.choosePort();
      signal?.throwIfAborted();
      const toolchain = await this.resolveToolchain();
      signal?.throwIfAborted();
      process = await this.launcher.launch({
        command: toolchain.command,
        args: [
          ...toolchain.args,
          "-e",
          plutoBootstrap({
            port,
            update: this.options.update,
            writeNotebookFiles: this.options.writeNotebookFiles,
          }),
        ],
        env: this.environment(toolchain),
        port,
      });
    }

    const exited = this.track(process);
    const url = `http://localhost:${port}`;
    try {
      await this.waitUntilReachable(url, exited, signal);
    } catch (error) {
      if (this.process === process) {
        this.process = undefined;
        await this.terminate(process);
      }
      throw error;
    }
    this.url = url;
    return url;
  }

  private async choosePort(): Promise<number> {
    const preferred = this.options.port;
    if (await isPortAvailable(preferred)) {
      return preferred;
    }
    const port = await findAvailablePort(preferred);
    this.log.warn(
      `Port ${preferred} is in use. Starting Pluto server on port ${port} instead.`
    );
    return port;
  }

  private environment(toolchain: JuliaToolchain): Record<string, string> {
    const env: Record<string, string> = {
      JULIA_DEPOT_PATH: resolveJuliaDepotPath(),
      JULIA_LOAD_PATH: isWindows() ? ";" : ":",
      ...toolchain.env,
    };
    if (toolchain.workspaceDir !== undefined) {
      env.JULIA_PLUTO_VSCODE_WORKSPACE = toolchain.workspaceDir;
    }
    if (toolchain.packageServer) {
      env.JULIA_PKG_SERVER = toolchain.packageServer;
    }
    if (toolchain.juliaHubToken) {
      env.JULIAHUB_TOKEN = toolchain.juliaHubToken;
    }
    return env;
  }

  /**
   * Make this the current process. Resolves when it exits; the exit
   * reaches onExit listeners only while it is still the current process.
   */
  private track(process: LaunchedProcess): Promise<void> {
    this.process = process;
    return new Promise((resolve) => {
      process.onExit(() => {
        resolve();
        if (this.process !== process) {
          return;
        }
        this.process = undefined;
        this.url = undefined;
        for (const listener of this.exitListeners) {
          listener();
        }
      });
    });
  }

  private async waitUntilReachable(
    url: string,
    exited: Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    const { timeoutMs, intervalMs } =
      this.options.readiness ?? DEFAULT_READINESS;
    const deadline = Date.now() + timeoutMs;
    let ended = false;
    void exited.then(() => {
      ended = true;
    });
    const aborted = new Promise<void>((resolve) =>
      signal?.addEventListener("abort", () => resolve(), { once: true })
    );

    for (;;) {
      signal?.throwIfAborted();
      if (ended) {
        throw new Error("Pluto server process exited before it was ready");
      }
      if (await isReachable(url)) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Pluto server did not start within ${timeoutMs / 1000} seconds`
        );
      }
      await Promise.race([delay(intervalMs), exited, aborted]);
    }
  }

  private async terminate(process: LaunchedProcess): Promise<void> {
    const ended = new Promise<boolean>((resolve) =>
      process.onExit(() => resolve(true))
    );
    process.terminate("graceful");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exitedInTime = await Promise.race([
      ended,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(
          () => resolve(false),
          this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
        );
      }),
    ]);
    clearTimeout(timer);
    if (!exitedInTime) {
      process.terminate("kill");
    }
  }
}

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}
