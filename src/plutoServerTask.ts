import * as vscode from "vscode";
import { isDefined } from "./helpers.ts";
import { isPortAvailable, findAvailablePort } from "./portUtils.ts";
import * as fs from "fs";
import * as path from "path";

/**
 * Parse Julia executable path to extract command and arguments
 */
function parseJuliaExecutable(executablePath: string): {
  command: string;
  args: string[];
} {
  // Split by spaces but respect quoted strings
  const parts = executablePath.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [
    executablePath,
  ];
  const command = parts[0].replace(/"/g, ""); // Remove quotes from command
  const args = parts.slice(1).map((arg) => arg.replace(/"/g, "")); // Remove quotes from args
  return { command, args };
}

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

        // Notify about port change
        if (this.onPortChangedCallback && this.actualPort !== this.port) {
          this.onPortChangedCallback(this.actualPort);
        }

        // Show notification to user about port change
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

    // Get Julia settings
    const juliaConfig = vscode.workspace.getConfiguration("julia");
    const executablePath = juliaConfig.get<string>("executablePath") || "julia";
    const environmentPath = juliaConfig.get<string>("environmentPath") ?? "";

    // Parse Julia executable to handle arguments like --sysimage
    const { command, args: baseArgs } = parseJuliaExecutable(executablePath);

    // Build Julia command arguments
    const juliaArgs = [
      "+1.11.7",
      ...baseArgs,
      "-e",
      `using Pluto; Pluto.run(port=${this.actualPort}; require_secret_for_open_links=false, require_secret_for_access=false, launch_browser=false)`,
    ];

    console.log(
      `[PlutoServerTask] Resolved command: ${command} ${juliaArgs.join(" ")}`
    );

    // Build environment variables
    const workspacePath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const env: { [key: string]: string } = {
      JULIA_PLUTO_VSCODE_WORKSPACE: workspacePath,
      JULIA_PKG_USE_CLI_GIT: "true",
      // JULIA_CPU_TARGET: "generic",
    };
    if (environmentPath) {
      env.JULIA_LOAD_PATH = environmentPath;
    }

    // Check if .env folder exists and create it if not
    if (workspacePath) {
      const envPath = path.join(workspacePath, ".env");
      if (!fs.existsSync(envPath)) {
        console.log(`[PlutoServerTask] Creating .env folder at ${envPath}`);
        fs.mkdirSync(envPath, { recursive: true });
      }
    }

    // Ensure Julia 1.11.7 is installed via juliaup
    const juliaupCommand =
      process.platform === "win32" ? "juliaup.exe" : "juliaup";
    try {
      console.log(
        `[PlutoServerTask] Checking if Julia 1.11.7 is available via juliaup`
      );

      const juliaupTaskDefinition: vscode.TaskDefinition = {
        type: "juliaup-add",
      };

      const juliaupExecution = new vscode.ShellExecution(juliaupCommand, [
        "add",
        "1.11.7",
      ]);

      const juliaupTask = new vscode.Task(
        juliaupTaskDefinition,
        vscode.TaskScope.Workspace,
        `Install Julia 1.11.7`,
        "pluto-notebook",
        juliaupExecution,
        []
      );
      juliaupTask.isBackground = false;

      const juliaupTaskExecution = await vscode.tasks.executeTask(juliaupTask);
      await new Promise<void>((resolve, reject) => {
        const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
          if (e.execution === juliaupTaskExecution) {
            disposable.dispose();
            if (e.exitCode === 0) {
              console.log(
                "[PlutoServerTask] Julia 1.11.7 installed/verified successfully"
              );
              resolve();
            } else {
              reject(
                new Error(`juliaup add failed with exit code ${e.exitCode}`)
              );
            }
          }
        });
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[PlutoServerTask] juliaup command failed: ${errorMessage}`
      );

      const action = await vscode.window.showErrorMessage(
        `Failed to install Julia 1.11.7 via juliaup. Please ensure juliaup is installed.`,
        "Install juliaup",
        "Continue anyway"
      );

      if (action === "Install juliaup") {
        await vscode.env.openExternal(
          vscode.Uri.parse("https://github.com/JuliaLang/juliaup#installation")
        );
        throw new Error("Please install juliaup and try again");
      }
      // If "Continue anyway" is selected, proceed without juliaup check
    }

    const setupTaskDefinition: vscode.TaskDefinition = {
      type: "pluto-setup",
    };

    const setupExecution = new vscode.ShellExecution(command, [
      "+1.11.7",
      ...baseArgs,
      `--project=${workspacePath}/.env`,
      `-e`,
      `import Pkg; Pkg.add("Pluto"); Pkg.instantiate(); Pkg.precompile();`,
    ]);

    const task1 = new vscode.Task(
      setupTaskDefinition,
      vscode.TaskScope.Workspace,
      `Instantiate Pluto`,
      "pluto-notebook",
      setupExecution,
      [] // No problem matchers
    );
    task1.isBackground = false;

    // Execute setup task and wait for it to complete
    const setupExecution1 = await vscode.tasks.executeTask(task1);
    await new Promise<void>((resolve, reject) => {
      const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution === setupExecution1) {
          disposable.dispose();
          if (e.exitCode === 0) {
            console.log("[PlutoServerTask] Setup task completed successfully");
            resolve();
          } else {
            reject(new Error(`Setup task failed with exit code ${e.exitCode}`));
          }
        }
      });
    });

    // Create the task definition
    const taskDefinition: vscode.TaskDefinition = {
      type: "pluto-server",
      port: this.actualPort,
    };

    // Create shell execution for Julia command
    const shellExecution = new vscode.ShellExecution(command, juliaArgs, {
      env,
    });

    // Create the task
    const task = new vscode.Task(
      taskDefinition,
      vscode.TaskScope.Workspace,
      `Pluto Server (port ${this.actualPort})`,
      "pluto-notebook",
      shellExecution,
      [] // No problem matchers
    );

    // Configure task presentation
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
      showReuseMessage: false,
      clear: false,
      focus: false,
      echo: true,
    };

    // Set as background task
    task.isBackground = true;

    // Listen for task end - this will reset state when task stops
    this.taskEndListener = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === this.taskExecution) {
        // Task ended - reset state
        this.taskExecution = undefined;
        this.serverReadyPromise = undefined;
        this.serverReadyResolve = undefined;
        this.isStarting = false;
        this.actualPort = this.port; // Reset to default port

        // Cleanup listener
        if (this.taskEndListener) {
          this.taskEndListener.dispose();
          this.taskEndListener = undefined;
        }

        // Notify callback that server stopped
        if (this.onStopCallback) {
          this.onStopCallback();
        }
      }
    });

    // Execute the task
    this.taskExecution = await vscode.tasks.executeTask(task);
    this.isStarting = false; // Clear starting flag once task is executing

    // Poll server URL until it responds (more reliable than timeout)
    try {
      // Wait for Julia environment setup and Pluto installation before polling
      // This gives time for Pkg.activate, Pkg.add, and Pkg.instantiate to complete
      await new Promise((r) => setTimeout(r, 15000)); // Initial wait before polling
      await this.pollServerReady();
      if (this.serverReadyResolve) {
        this.serverReadyResolve();
      }
    } catch (error) {
      // Server didn't become ready in time
      this.taskExecution.terminate();
      this.taskExecution = undefined;
      this.isStarting = false;

      // Cleanup listener
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
    const maxAttempts = 60; // 60 seconds total (60 attempts * 1 second)
    const pollInterval = 1000; // 1 second between attempts

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Try to fetch from server
        const response = await fetch(this.getServerUrl(), {
          method: "GET",
          signal: AbortSignal.timeout(2000), // 2 second timeout per request
        });

        // If we get any response (even error), server is running
        if (isDefined(response)) {
          return;
        }
      } catch {
        // Server not ready yet, continue polling
      }

      // Wait before next attempt
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

    // Terminate the task (this will trigger the onDidEndTaskProcess listener)
    this.taskExecution.terminate();
    // Note: State reset happens in the listener
    // Reset actual port to default port when stopped
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
