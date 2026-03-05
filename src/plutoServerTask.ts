import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { isDefined } from "./helpers.ts";
import { isPortAvailable, findAvailablePort } from "./portUtils.ts";
import { isWindows } from "./platformUtils.ts";
import {
  getJuliaExecutable,
  getPackageServer,
  getJuliaHubToken,
} from "./julia-utils.ts";

/**
 * Manages Pluto server as a VSCode task with terminal integration
 */
export class PlutoServerTaskManager {
  private taskExecution?: vscode.TaskExecution;
  private serverReadyPromise?: Promise<void>;
  private serverReadyResolve?: () => void;
  private onStopCallback?: () => void;
  private taskEndListener?: vscode.Disposable;
  private isStarting = false;
  private actualPort: number;
  private onPortChangedCallback?: (newPort: number) => void;

  constructor(private readonly port = 1234) {
    this.actualPort = port;
  }

  /**
   * Check if server task is running
   */
  public isRunning(): boolean {
    return !!this.taskExecution || this.isStarting;
  }

  /**
   * Set callback to be called when server stops
   */
  public onStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  /**
   * Set callback to be called when port changes
   */
  public onPortChanged(callback: (newPort: number) => void): void {
    this.onPortChangedCallback = callback;
  }

  /**
   * Get the actual port being used by the server
   */
  public getActualPort(): number {
    return this.actualPort;
  }

  /**
   * Start Pluto server as a VSCode task
   */
  public async start(): Promise<void> {
    if (this.taskExecution || this.isStarting) {
      throw new Error("Pluto server task is already running");
    }

    // Check if there's already a Pluto server task running from a previous session
    const existingTasks = vscode.tasks.taskExecutions;
    for (const execution of existingTasks) {
      if (
        execution.task.name === `Pluto Server (port ${this.actualPort})` ||
        execution.task.definition.type === "pluto-server"
      ) {
        console.log(
          "[PlutoServerTask] Found existing task, reusing it instead of creating new one"
        );
        this.taskExecution = execution;
        return;
      }
    }

    // Set starting flag immediately to prevent race condition
    this.isStarting = true;

    // Check if default port is available, if not find an available port
    const portAvailable = await isPortAvailable(this.port);
    if (!portAvailable) {
      console.log(
        `[PlutoServerTask] Port ${this.port} is not available, finding alternative...`
      );
      try {
        this.actualPort = await findAvailablePort(this.port);
        console.log(
          `[PlutoServerTask] Found available port: ${this.actualPort}`
        );

        if (this.onPortChangedCallback && this.actualPort !== this.port) {
          this.onPortChangedCallback(this.actualPort);
        }

        if (this.actualPort !== this.port) {
          vscode.window.showWarningMessage(
            `Port ${this.port} is in use. Starting Pluto server on port ${this.actualPort} instead.`
          );
        }
      } catch (error) {
        this.isStarting = false;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to find available port: ${errorMessage}`);
      }
    } else {
      this.actualPort = this.port;
    }

    // Create promise that resolves when server is ready
    this.serverReadyPromise = new Promise<void>((resolve) => {
      this.serverReadyResolve = resolve;
    });

    // Get workspace path
    const workspacePath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    // --- Step 1: Get Julia executable from the Julia extension ---
    // Julia is guaranteed installed because julialang.language-julia is an extensionDependency.
    const { command, args: channelArgs } = await getJuliaExecutable();
    console.log(
      `[PlutoServerTask] Julia executable: ${command} ${channelArgs.join(" ")}`
    );

    // --- Step 3: Get package server and optional JuliaHub token ---
    const packageServer = await getPackageServer();
    if (packageServer) {
      console.log(
        `[PlutoServerTask] Package server from Julia extension: ${packageServer}`
      );
    }

    const juliaHubToken = await getJuliaHubToken();

    // --- Step 4: Build env vars for the server process ---
    const env: { [key: string]: string } = {
      JULIA_PLUTO_VSCODE_WORKSPACE: workspacePath,
      JULIA_DEPOT_PATH: path.join(os.homedir(), ".julia"),
      JULIA_LOAD_PATH: isWindows() ? ";" : ":",
      JULIAHUB_TOKEN: juliaHubToken,
    };
    if (packageServer) {
      env.JULIA_PKG_SERVER = packageServer;
    }

    // --- Step 5: Start the Pluto server task (setup + run in one process) ---
    // Setup steps run first in the same Julia session, then Pluto.run() blocks.
    const serverCode = [
      `import Pkg`,
      `s = string`,
      `Pkg.activate(mkpath(joinpath(Pkg.depots1(), s(:environments), s(:vscode_pluto_notebook), string(VERSION))))`,
      `Pkg.Registry.add()`,
      `Pkg.add(s(:Pluto))`,
      `Pkg.add(s(:Pkg))`,
      `Pkg.instantiate()`,
      `Pkg.precompile()`,
      `using Pluto`,
      `Pluto.run(port=${this.actualPort}; require_secret_for_open_links=false, require_secret_for_access=false, launch_browser=false)`,
    ].join(";");
    const juliaArgs = [...channelArgs, "-e", serverCode];

    console.log(
      `[PlutoServerTask] Resolved command: ${command} ${juliaArgs.join(" ")}`
    );

    const taskDefinition: vscode.TaskDefinition = {
      type: "pluto-server",
      port: this.actualPort,
    };

    const processExecution = new vscode.ProcessExecution(
      command,
      juliaArgs,
      { env }
    );

    const task = new vscode.Task(
      taskDefinition,
      vscode.TaskScope.Workspace,
      `Pluto Server (port ${this.actualPort})`,
      "pluto-notebook",
      processExecution,
      []
    );

    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Shared,
      showReuseMessage: false,
      clear: false,
      focus: false,
      echo: true,
    };
    task.isBackground = true;

    // Listen for task end to reset state
    this.taskEndListener = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === this.taskExecution) {
        this.taskExecution = undefined;
        this.serverReadyPromise = undefined;
        this.serverReadyResolve = undefined;
        this.isStarting = false;
        this.actualPort = this.port;

        if (this.taskEndListener) {
          this.taskEndListener.dispose();
          this.taskEndListener = undefined;
        }

        if (this.onStopCallback) {
          this.onStopCallback();
        }
      }
    });

    this.taskExecution = await vscode.tasks.executeTask(task);
    this.isStarting = false;

    // Poll until the server responds
    try {
      await new Promise((r) => setTimeout(r, 15000));
      await this.pollServerReady();
      if (this.serverReadyResolve) {
        this.serverReadyResolve();
      }
    } catch (error) {
      this.taskExecution.terminate();
      this.taskExecution = undefined;
      this.isStarting = false;

      if (isDefined(this.taskEndListener)) {
        this.taskEndListener.dispose();
        this.taskEndListener = undefined;
      }

      throw error;
    }
  }

  /**
   * Poll server URL until it responds
   */
  private async pollServerReady(): Promise<void> {
    const maxAttempts = 60;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(this.getServerUrl(), {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });

        if (isDefined(response)) {
          return;
        }
      } catch {
        // Server not ready yet, continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Pluto server did not start within ${maxAttempts} seconds`);
  }

  /**
   * Stop Pluto server task
   */
  public async stop(): Promise<void> {
    if (!this.taskExecution) {
      return;
    }

    this.taskExecution.terminate();
    this.actualPort = this.port;
  }

  /**
   * Get the server URL
   */
  public getServerUrl(): string {
    return `http://localhost:${this.actualPort}`;
  }

  /**
   * Wait for server to be ready
   */
  public async waitForReady(): Promise<void> {
    if (this.serverReadyPromise) {
      await this.serverReadyPromise;
    }
  }
}
