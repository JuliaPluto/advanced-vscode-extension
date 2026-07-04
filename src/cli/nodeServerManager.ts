import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { IPlutoServerManager } from "../plutoManagerTypes.ts";
import { isPortAvailable, findAvailablePort } from "../portUtils.ts";
import { getExecutableName, isWindows } from "../platformUtils.ts";

export class NodeServerManager implements IPlutoServerManager {
  private juliaProcess?: ChildProcess;
  private actualPort: number;
  private starting = false;
  private onStopCallback?: () => void;
  private onPortChangedCallback?: (port: number) => void;

  constructor(
    private readonly port: number,
    private readonly juliaVersion: string,
    private readonly workDir: string
  ) {
    this.actualPort = port;
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
        this.actualPort = await findAvailablePort(this.port);
        console.log(`[pluto] Using port ${this.actualPort}`);
        if (this.actualPort !== this.port && this.onPortChangedCallback) {
          this.onPortChangedCallback(this.actualPort);
        }
      } else {
        this.actualPort = this.port;
      }

      // 2. Check Julia is available
      const juliaCmd = getExecutableName("julia");
      const juliaCheck = spawnSync(juliaCmd, ["--version"], {
        stdio: "pipe",
        timeout: 10000,
      });
      if (juliaCheck.error) {
        console.error(
          "Error: Julia not found. Please install Julia from https://julialang.org/downloads/"
        );
        console.error(
          "  or install juliaup from https://github.com/JuliaLang/juliaup#installation"
        );
        process.exit(1);
      }

      // 3. Try juliaup to ensure the requested version is available
      let useJuliaupPrefix = true;
      const juliaupCmd = getExecutableName("juliaup");
      const juliaupResult = spawnSync(juliaupCmd, ["add", this.juliaVersion], {
        stdio: "pipe",
        timeout: 60000,
      });
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

      // 4. Build Julia arguments
      const juliaArgs = useJuliaupPrefix ? [`+${this.juliaVersion}`] : [];

      // 5. Environment variables
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        JULIA_DEPOT_PATH: path.join(os.homedir(), ".julia"),
        JULIA_LOAD_PATH: isWindows() ? ";" : ":",
      };
      if (this.workDir) {
        env.JULIA_PLUTO_VSCODE_WORKSPACE = this.workDir;
      }

      // 6. Optional JuliaHub auth
      this.tryJuliaHubAuth(env, juliaCmd, juliaArgs);

      // 7. Setup task — install Pluto if needed
      console.log(
        "[pluto] Setting up Julia environment (first run may take a few minutes)..."
      );
      const setupCode = [
        "import Pkg",
        "s = string",
        `Pkg.activate(mkpath(joinpath(Pkg.depots1(), s(:environments), s(:vscode_pluto_notebook), string(VERSION))))`,
        "Pkg.Registry.add()",
        "Pkg.add(s(:Pluto))",
        "Pkg.add(s(:Pkg))",
        "Pkg.instantiate()",
        "Pkg.precompile()",
      ].join(";");

      const setupResult = spawnSync(juliaCmd, [...juliaArgs, "-e", setupCode], {
        stdio: "inherit",
        env,
        timeout: 600000,
      });
      if (setupResult.status !== 0) {
        throw new Error(
          `Julia setup failed with exit code ${setupResult.status}`
        );
      }

      // 8. Start Pluto server
      const runCode = `import Pkg;s = string;Pkg.activate(mkpath(joinpath(Pkg.depots1(), s(:environments), s(:vscode_pluto_notebook), string(VERSION))));using Pluto; Pluto.run(port=${this.actualPort}; require_secret_for_open_links=false, require_secret_for_access=false, launch_browser=false)`;

      console.log(
        `[pluto] Starting Pluto server on port ${this.actualPort}...`
      );
      this.juliaProcess = spawn(juliaCmd, [...juliaArgs, "-e", runCode], {
        stdio: ["ignore", "pipe", "pipe"],
        env,
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
        this.actualPort = this.port;
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
    this.actualPort = this.port;
  }

  private tryJuliaHubAuth(
    env: Record<string, string>,
    juliaCmd: string,
    juliaArgs: string[]
  ): void {
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

      const result = spawnSync(juliaCmd, [...juliaArgs, "-e", script], {
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
    // Initial wait for Julia to start up
    await new Promise((r) => setTimeout(r, 5000));

    const maxAttempts = 120;
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
