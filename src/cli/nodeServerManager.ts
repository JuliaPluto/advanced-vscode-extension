import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { IPlutoServerManager } from "../plutoManagerTypes.ts";
import { isPortAvailable, findAvailablePort } from "../portUtils.ts";
import {
  getExecutableName,
  isWindows,
  resolveJuliaDepotPath,
} from "../platformUtils.ts";

/**
 * Run a child process to completion without blocking the event loop
 * (unlike spawnSync — the MCP health endpoint must stay responsive
 * while Julia setup runs).
 */
function runProcess(
  command: string,
  args: string[],
  options: SpawnOptions
): Promise<{ status: number | null; error?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    // Drain piped output — an undrained pipe blocks the child once the
    // OS buffer (~64KB) fills, which spawnSync's buffering used to hide
    child.stdout?.resume();
    child.stderr?.resume();
    child.on("error", (error) => resolve({ status: null, error }));
    child.on("exit", (code) => resolve({ status: code }));
  });
}

export class NodeServerManager implements IPlutoServerManager {
  private juliaProcess?: ChildProcess;
  private actualPort: number;
  /** Port the manager last heard about; every change is reported, including back to the default. */
  private lastReportedPort: number;
  private starting = false;
  private onStopCallback?: () => void;
  private onPortChangedCallback?: (port: number) => void;

  constructor(
    private readonly port: number,
    private readonly juliaVersion: string,
    private readonly workDir: string,
    private readonly options: { update?: boolean } = {}
  ) {
    this.actualPort = port;
    this.lastReportedPort = port;
  }

  /** "default" (or "system") means: no juliaup channel pin, use whatever `julia` is. */
  private get usesJuliaupChannel(): boolean {
    return !["default", "system", ""].includes(this.juliaVersion);
  }

  isRunning(): boolean {
    return !!this.juliaProcess || this.starting;
  }

  onStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  onPortChanged(callback: (port: number) => void): void {
    this.onPortChangedCallback = callback;
  }

  /**
   * Record the port the server actually uses and tell the manager when it
   * differs from what it last heard — a return to the default port after
   * a run on an alternative one is a change too.
   */
  private setActualPort(port: number): void {
    this.actualPort = port;
    if (port !== this.lastReportedPort) {
      this.lastReportedPort = port;
      this.onPortChangedCallback?.(port);
    }
  }

  getActualPort(): number {
    return this.actualPort;
  }

  getServerUrl(): string {
    return `http://localhost:${this.actualPort}`;
  }

  async waitForReady(): Promise<void> {
    // start() already polls — nothing extra needed
  }

  async start(): Promise<void> {
    if (this.juliaProcess || this.starting) {
      throw new Error("Pluto server is already running");
    }
    this.starting = true;

    try {
      // 1. Check port availability
      const portAvailable = await isPortAvailable(this.port);
      if (!portAvailable) {
        console.log(
          `[pluto] Port ${this.port} is in use, finding alternative...`
        );
        this.setActualPort(await findAvailablePort(this.port));
        console.log(`[pluto] Using port ${this.actualPort}`);
      } else {
        this.setActualPort(this.port);
      }

      // 2. Check Julia is available
      const juliaCmd = getExecutableName("julia");
      const juliaCheck = await runProcess(juliaCmd, ["--version"], {
        stdio: "pipe",
        timeout: 10000,
      });
      if (juliaCheck.error) {
        throw new Error(
          "Julia not found. Please install Julia from https://julialang.org/downloads/ " +
            "or install juliaup from https://github.com/JuliaLang/juliaup#installation"
        );
      }

      // 3. Pin the requested juliaup channel, unless the user asked for their default julia
      let useJuliaupPrefix = this.usesJuliaupChannel;
      if (useJuliaupPrefix) {
        const juliaupCmd = getExecutableName("juliaup");
        const juliaupResult = await runProcess(
          juliaupCmd,
          ["add", this.juliaVersion],
          {
            stdio: "pipe",
            timeout: 60000,
          }
        );
        if (juliaupResult.error) {
          console.log(
            "[pluto] juliaup not found — using system julia (ignoring --julia-version)"
          );
          useJuliaupPrefix = false;
        } else if (juliaupResult.status !== 0) {
          console.warn(
            `[pluto] juliaup add ${this.juliaVersion} failed (exit ${juliaupResult.status}), continuing with system julia`
          );
          useJuliaupPrefix = false;
        }
      }

      // 4. Build Julia arguments
      const juliaArgs = useJuliaupPrefix ? [`+${this.juliaVersion}`] : [];

      // 5. Environment variables
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        JULIA_DEPOT_PATH: resolveJuliaDepotPath(),
        JULIA_LOAD_PATH: isWindows() ? ";" : ":",
      };
      if (this.workDir) {
        env.JULIA_PLUTO_VSCODE_WORKSPACE = this.workDir;
      }

      // 6. Optional JuliaHub auth
      await this.tryJuliaHubAuth(env, juliaCmd, juliaArgs);

      // 7. One Julia process: make sure Pluto is present in the shared
      // environment, then serve. Pkg.instantiate() always runs so a pruned
      // depot is repaired; the registry update and resolve only run when
      // Pluto is not in the project yet or --update was passed.
      const install = this.options.update ? "true" : "false";
      const runCode = [
        "import Pkg",
        "s = string",
        "env = mkpath(joinpath(Pkg.depots1(), s(:environments), s(:vscode_pluto_notebook), string(VERSION)))",
        "Pkg.activate(env)",
        `if ${install} || !haskey(Pkg.project().dependencies, s(:Pluto))`,
        "Pkg.Registry.add()",
        "Pkg.add(s(:Pluto))",
        "Pkg.add(s(:Pkg))",
        "end",
        "Pkg.instantiate()",
        `if ${install}`,
        "Pkg.precompile()",
        "end",
        "using Pluto",
        `Pluto.run(port=${this.actualPort}; require_secret_for_open_links=false, require_secret_for_access=false, launch_browser=false)`,
      ].join(";");

      console.log(
        this.options.update
          ? "[pluto] Installing and precompiling Pluto (--update), then starting the server..."
          : "[pluto] Starting Pluto (first run installs Pluto and may take a few minutes)..."
      );
      this.juliaProcess = spawn(juliaCmd, [...juliaArgs, "-e", runCode], {
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      // Whatever ends this process, Julia must not outlive it
      const julia = this.juliaProcess;
      process.once("exit", () => {
        if (!julia.killed && julia.exitCode === null) {
          julia.kill("SIGKILL");
        }
      });

      this.juliaProcess.stdout?.on("data", (data: Buffer) => {
        process.stderr.write(`[julia] ${data}`);
      });
      this.juliaProcess.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(`[julia] ${data}`);
      });

      this.juliaProcess.on("exit", (code) => {
        console.log(`[pluto] Julia process exited with code ${code}`);
        this.juliaProcess = undefined;
        this.starting = false;
        this.setActualPort(this.port);
        this.onStopCallback?.();
      });

      this.juliaProcess.on("error", (err) => {
        console.error(`[pluto] Julia process error: ${err.message}`);
        this.juliaProcess = undefined;
        this.starting = false;
      });

      // 9. Poll until server is ready
      await this.pollServerReady();
      this.starting = false;
      console.log(`[pluto] Pluto server is ready at ${this.getServerUrl()}`);
    } catch (err) {
      this.starting = false;
      // Kill process if it was started
      if (this.juliaProcess) {
        this.juliaProcess.kill();
        this.juliaProcess = undefined;
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.juliaProcess) return;
    this.juliaProcess.kill();
    // Wait briefly for process to exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still alive
        if (this.juliaProcess) {
          this.juliaProcess.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      if (this.juliaProcess) {
        this.juliaProcess.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });
    this.juliaProcess = undefined;
    this.setActualPort(this.port);
  }

  private async tryJuliaHubAuth(
    env: Record<string, string>,
    juliaCmd: string,
    juliaArgs: string[]
  ): Promise<void> {
    try {
      const jhCmd = getExecutableName("jh");
      const tmpFile = path.join(
        os.tmpdir(),
        `.pluto-mcp-auth-${process.pid}.txt`
      );

      const script = [
        `s = string`,
        `auth_path = "${tmpFile.replace(/\\/g, "/")}"`,
        `try output = read(\`${jhCmd} auth env\`, String)`,
        `    open(io -> write(io, output), auth_path, s(:w))`,
        `catch e`,
        `    open(io -> write(io, s()), auth_path, s(:w))`,
        `end`,
        `try read(\`${jhCmd} auth refresh\`, String)`,
        `catch e;`,
        `end`,
      ].join(";");

      const result = await runProcess(juliaCmd, [...juliaArgs, "-e", script], {
        env: { ...env, VSCODE_PLUTO_AUTH_FILE: tmpFile },
        stdio: "pipe",
        timeout: 15000,
      });

      if (result.status === 0 && fs.existsSync(tmpFile)) {
        const content = fs.readFileSync(tmpFile, "utf-8");
        fs.unlinkSync(tmpFile);

        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && trimmed.includes("=")) {
            const [key, ...valueParts] = trimmed.split("=");
            const value = valueParts.join("=");
            if (key.trim() === "JULIAHUB_HOST" && value.trim()) {
              env.JULIA_PKG_SERVER = value.trim();
              console.log(`[pluto] Using JULIAHUB_HOST: ${value.trim()}`);
            }
          }
        }
      }
    } catch {
      // jh not available — skip silently
    }
  }

  private async pollServerReady(): Promise<void> {
    // Long enough for a cold install and precompile of Pluto
    const maxAttempts = 600;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check if process died
      if (!this.juliaProcess) {
        throw new Error("Julia process exited before server became ready");
      }

      try {
        const response = await fetch(this.getServerUrl(), {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });
        if (response) return;
      } catch {
        // Not ready yet
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(`Pluto server did not start within ${maxAttempts} seconds`);
  }
}
