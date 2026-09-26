import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  getExecutableName,
  isWindows,
  resolveJuliaDepotPath,
} from "../platformUtils.ts";
import type {
  LaunchSpec,
  LaunchedProcess,
  ProcessLauncher,
} from "../server/launcher.ts";
import type { JuliaToolchain } from "../server/plutoServer.ts";

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

/** Runs the Pluto server as a child process of the CLI. */
export class SpawnLauncher implements ProcessLauncher {
  public async launch(spec: LaunchSpec): Promise<LaunchedProcess> {
    const julia = spawn(spec.command, spec.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...spec.env },
    });
    // Whatever ends this process, Julia must not outlive it
    process.once("exit", () => {
      if (!julia.killed && julia.exitCode === null) {
        julia.kill("SIGKILL");
      }
    });
    julia.stdout?.on("data", (data: Buffer) => {
      process.stderr.write(`[julia] ${data}`);
    });
    julia.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[julia] ${data}`);
    });
    return new ChildHandle(julia);
  }
}

class ChildHandle implements LaunchedProcess {
  private exit?: { code: number | undefined };
  private readonly listeners: Array<(code: number | undefined) => void> = [];

  constructor(private readonly child: ChildProcess) {
    child.on("exit", (code) => {
      console.log(`[pluto] Julia process exited with code ${code}`);
      this.end(code ?? undefined);
    });
    child.on("error", (error) => {
      console.error(`[pluto] Julia process error: ${error.message}`);
      this.end(undefined);
    });
  }

  private end(code: number | undefined): void {
    if (this.exit) {
      return;
    }
    this.exit = { code };
    for (const listener of this.listeners.splice(0)) {
      listener(code);
    }
  }

  public onExit(listener: (code: number | undefined) => void): void {
    if (this.exit) {
      listener(this.exit.code);
    } else {
      this.listeners.push(listener);
    }
  }

  public terminate(how: "graceful" | "kill"): void {
    this.child.kill(how === "kill" ? "SIGKILL" : "SIGTERM");
  }
}

export interface CliToolchainOptions {
  /** juliaup channel; "default", "system" or "" use whatever `julia` is. */
  juliaVersion: string;
  workDir: string;
  update: boolean;
}

/**
 * `julia` from PATH, pinned to a juliaup channel when one is asked for
 * and available, with the package server from `jh auth env` when JuliaHub
 * is set up.
 */
export async function resolveCliToolchain(
  options: CliToolchainOptions
): Promise<JuliaToolchain> {
  const command = getExecutableName("julia");
  const check = await runProcess(command, ["--version"], {
    stdio: "pipe",
    timeout: 10000,
  });
  if (check.error) {
    throw new Error(
      "Julia not found. Please install Julia from https://julialang.org/downloads/ " +
        "or install juliaup from https://github.com/JuliaLang/juliaup#installation"
    );
  }

  const args = (await pinJuliaupChannel(options.juliaVersion))
    ? [`+${options.juliaVersion}`]
    : [];
  const packageServer = await juliaHubPackageServer(command, args);

  console.log(
    options.update
      ? "[pluto] Installing and precompiling Pluto (--update), then starting the server..."
      : "[pluto] Starting Pluto (first run installs Pluto and may take a few minutes)..."
  );
  return {
    command,
    args,
    packageServer,
    workspaceDir: options.workDir || undefined,
  };
}

async function pinJuliaupChannel(juliaVersion: string): Promise<boolean> {
  if (["default", "system", ""].includes(juliaVersion)) {
    return false;
  }
  const result = await runProcess(
    getExecutableName("juliaup"),
    ["add", juliaVersion],
    { stdio: "pipe", timeout: 60000 }
  );
  if (result.error) {
    console.log(
      "[pluto] juliaup not found — using system julia (ignoring --julia-version)"
    );
    return false;
  }
  if (result.status !== 0) {
    console.warn(
      `[pluto] juliaup add ${juliaVersion} failed (exit ${result.status}), continuing with system julia`
    );
    return false;
  }
  return true;
}

async function juliaHubPackageServer(
  juliaCmd: string,
  juliaArgs: string[]
): Promise<string | undefined> {
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
      env: {
        ...process.env,
        JULIA_DEPOT_PATH: resolveJuliaDepotPath(),
        JULIA_LOAD_PATH: isWindows() ? ";" : ":",
        VSCODE_PLUTO_AUTH_FILE: tmpFile,
      },
      stdio: "pipe",
      timeout: 15000,
    });

    if (result.status !== 0 || !fs.existsSync(tmpFile)) {
      return undefined;
    }
    const content = fs.readFileSync(tmpFile, "utf-8");
    fs.unlinkSync(tmpFile);

    for (const line of content.split("\n")) {
      const [key, ...valueParts] = line.trim().split("=");
      const value = valueParts.join("=").trim();
      if (key.trim() === "JULIAHUB_HOST" && value) {
        console.log(`[pluto] Using JULIAHUB_HOST: ${value}`);
        return value;
      }
    }
  } catch {
    // jh not available — skip silently
  }
  return undefined;
}
