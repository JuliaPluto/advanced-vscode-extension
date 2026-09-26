import * as vscode from "vscode";
import {
  commandUsesJuliaupChannel,
  isJuliaVersionSupportedByPluto,
  NEWEST_SUPPORTED_JULIA,
} from "./platformUtils.ts";
import {
  getJuliaExecutable,
  getPackageServer,
  getJuliaHubToken,
} from "./julia-utils.ts";
import type {
  LaunchSpec,
  LaunchedProcess,
  ProcessLauncher,
} from "./server/launcher.ts";
import type { JuliaToolchain } from "./server/plutoServer.ts";

const TASK_TYPE = "pluto-server";

/**
 * Runs the Pluto server as a VS Code task, so its output shows in the
 * terminal panel and the task survives a reload of the extension host.
 */
export class VscodeTaskLauncher implements ProcessLauncher {
  /** Executions this launcher already owns, launched or adopted. */
  private readonly known = new WeakSet<vscode.TaskExecution>();

  public async launch(spec: LaunchSpec): Promise<LaunchedProcess> {
    console.log(
      `[PlutoServerTask] Resolved command: ${spec.command} ${spec.args.join(" ")}`
    );
    const task = new vscode.Task(
      { type: TASK_TYPE, port: spec.port },
      vscode.TaskScope.Workspace,
      `Pluto Server (port ${spec.port})`,
      "pluto-notebook",
      new vscode.ProcessExecution(spec.command, spec.args, { env: spec.env }),
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

    // Collect ends from the start, so an immediate exit is not missed
    const ended = new Map<vscode.TaskExecution, number | undefined>();
    const early = vscode.tasks.onDidEndTaskProcess((e) =>
      ended.set(e.execution, e.exitCode)
    );
    try {
      const execution = await vscode.tasks.executeTask(task);
      this.known.add(execution);
      return new TaskProcess(execution, ended);
    } finally {
      early.dispose();
    }
  }

  /**
   * A Pluto server task left running by an earlier extension host. One this
   * launcher already owned is never taken again: VS Code lists a task for a
   * while after its process ended, and one that outlived a stop is dying.
   */
  public async adopt(): Promise<
    { process: LaunchedProcess; port: number } | undefined
  > {
    const execution = vscode.tasks.taskExecutions.find(
      (e) => e.task.definition.type === TASK_TYPE && !this.known.has(e)
    );
    const port = execution?.task.definition.port as number | undefined;
    if (!execution || !port) {
      return undefined;
    }
    this.known.add(execution);
    return { process: new TaskProcess(execution), port };
  }
}

class TaskProcess implements LaunchedProcess {
  private exit?: { code: number | undefined };
  private readonly listeners: Array<(code: number | undefined) => void> = [];
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly execution: vscode.TaskExecution,
    endedEarly?: Map<vscode.TaskExecution, number | undefined>
  ) {
    this.subscription = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) {
        this.end(e.exitCode);
      }
    });
    if (endedEarly?.has(execution)) {
      this.end(endedEarly.get(execution));
    }
  }

  private end(code: number | undefined): void {
    if (this.exit) {
      return;
    }
    this.exit = { code };
    this.subscription.dispose();
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

  /** A task has one way to end its process, so "kill" repeats the request. */
  public terminate(): void {
    this.execution.terminate();
  }
}

/**
 * The Julia the Julia extension uses, with the package server, JuliaHub
 * token and juliaup settings of this workspace.
 */
export async function resolveExtensionToolchain(): Promise<JuliaToolchain> {
  const { command, args, version } = await getJuliaExecutable();
  console.log(
    `[PlutoServerTask] Julia executable: ${command} ${args.join(" ")} (${version ?? "unknown version"})`
  );
  if (version && !isJuliaVersionSupportedByPluto(version)) {
    void offerSupportedJuliaChannel(version);
  }

  const packageServer = await getPackageServer();
  if (packageServer) {
    console.log(
      `[PlutoServerTask] Package server from Julia extension: ${packageServer}`
    );
  }

  // The JuliaHub token is optional — a declined/failed authentication
  // must not prevent the local Pluto server from starting
  let juliaHubToken: string | undefined;
  try {
    juliaHubToken = await getJuliaHubToken();
  } catch (error) {
    console.warn(
      "[PlutoServerTask] Continuing without JuliaHub token:",
      error instanceof Error ? error.message : String(error)
    );
  }

  warnIfDyadChannelLost(command, args);

  return {
    command,
    args,
    packageServer,
    juliaHubToken,
    workspaceDir: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
    env: resolveJuliaupEnv(),
  };
}

/**
 * juliaup settings the server process needs to resolve a `+channel`
 * executable: Dyad Studio installs its channel from JuliaHub's juliaup
 * server, so the task must see the same server and depot the REPL uses.
 */
function resolveJuliaupEnv(): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  const configuredServer = vscode.workspace
    .getConfiguration("julia")
    .get<string>("juliaup.server");
  const server = configuredServer?.trim() || process.env.JULIAUP_SERVER;
  if (server) {
    env.JULIAUP_SERVER = server;
  }
  if (process.env.JULIAUP_DEPOT_PATH) {
    env.JULIAUP_DEPOT_PATH = process.env.JULIAUP_DEPOT_PATH;
  }
  return env;
}

/**
 * Pluto does not run on Julia minors newer than the newest supported one.
 * Offers to pin the Julia extension to the supported juliaup channel; the
 * server keeps starting on the current Julia so the user can still decline.
 */
async function offerSupportedJuliaChannel(version: string): Promise<void> {
  const channel = NEWEST_SUPPORTED_JULIA.channel;
  const useSupported = `Use Julia ${channel}`;
  const choice = await vscode.window.showWarningMessage(
    `Pluto: the Julia extension is using Julia ${version}, which Pluto does not support yet. Set julia.executablePath to "julia +${channel}"?`,
    useSupported,
    "Ignore"
  );
  if (choice !== useSupported) {
    return;
  }
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace
    .getConfiguration("julia")
    .update("executablePath", `julia +${channel}`, target);
  const restart = "Restart Pluto Server";
  const next = await vscode.window.showInformationMessage(
    `Pluto: julia.executablePath set to "julia +${channel}". Install the channel with "juliaup add ${channel}" if it is missing, then restart the Pluto server.`,
    restart
  );
  if (next === restart) {
    await vscode.commands.executeCommand("pluto-notebook.restartServer");
  }
}

/**
 * Dyad Studio points `julia.executablePath` at a `+dyad-<version>` channel.
 * When the Julia extension resolved something else (fallback binary, user
 * override), a Dyad notebook would run on a Julia without the Dyad stack.
 */
function warnIfDyadChannelLost(command: string, args: string[]): void {
  const configured =
    vscode.workspace.getConfiguration("julia").get<string>("executablePath") ??
    "";
  const wanted = configured.match(/\+(dyad-\S+)/)?.[1];
  if (!wanted) {
    return;
  }
  const resolved = [command, ...args].join(" ");
  if (!commandUsesJuliaupChannel(wanted, resolved)) {
    vscode.window.showWarningMessage(
      `Pluto: this workspace uses Julia channel ${wanted}, but the Pluto server is starting with "${resolved}". Dyad notebooks may fail to load their packages.`
    );
  }
}
