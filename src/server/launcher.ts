/**
 * The one thing the two hosts do differently: how the long-lived server
 * process is launched, observed for exit and terminated. The extension
 * runs it as a VS Code task, the CLI as a child process.
 */
export interface LaunchSpec {
  command: string;
  args: string[];
  /** Additions to the environment the launcher gives its processes. */
  env: Record<string, string>;
  /** The port the server will listen on, for labelling the process. */
  port: number;
}

export interface LaunchedProcess {
  /** Called once when the process ends; immediately if it already has. */
  onExit(listener: (code: number | undefined) => void): void;
  /** "kill" is the escalation after a graceful request is ignored. */
  terminate(how: "graceful" | "kill"): void;
}

export interface ProcessLauncher {
  launch(spec: LaunchSpec): Promise<LaunchedProcess>;
  /** A server process left running by an earlier session, if any. */
  adopt?(): Promise<{ process: LaunchedProcess; port: number } | undefined>;
}
