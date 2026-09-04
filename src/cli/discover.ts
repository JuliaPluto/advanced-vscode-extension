/**
 * Finds what is already running: a Pluto server and a Pluto tool server
 * (either this CLI's `run` or the VS Code extension's built-in one).
 */

export type McpHost = "vscode" | "cli" | "unknown";

export interface McpProbe {
  port: number;
  url: string;
  host: McpHost;
  version?: string;
  plutoRunning: boolean;
  plutoUrl?: string;
  sessions: number;
}

export interface PlutoProbe {
  url: string;
  running: boolean;
}

export interface Status {
  insideVSCode: boolean;
  pluto: PlutoProbe;
  mcp: McpProbe | undefined;
  /** Port that was probed for the tool server when none was found. */
  mcpPort: number;
}

const PROBE_TIMEOUT_MS = 800;

/**
 * How many ports above the base to try. The extension moves up one port at
 * a time when its configured port is busy, so a handful of extra windows or
 * stray listeners still land inside this range.
 */
const VSCODE_PORT_SPREAD = 10;

/**
 * True when the process runs inside a VS Code terminal (directly or through
 * an agent launched from one). VS Code marks its terminals with TERM_PROGRAM
 * and a family of VSCODE_* variables that child processes inherit.
 */
export function isInsideVSCode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERM_PROGRAM === "vscode") return true;
  return [
    "VSCODE_PID",
    "VSCODE_IPC_HOOK_CLI",
    "VSCODE_GIT_IPC_HANDLE",
    "VSCODE_INJECTION",
    "VSCODE_CWD",
  ].some((name) => !!env[name]);
}

export async function probeMcp(
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<McpProbe | undefined> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      status?: string;
      host?: string;
      version?: string;
      plutoServerRunning?: boolean;
      plutoUrl?: string;
      activeSessions?: number;
    };
    if (body.status !== "ok" || typeof body.plutoServerRunning !== "boolean") {
      return undefined;
    }
    const host: McpHost =
      body.host === "vscode" || body.host === "cli" ? body.host : "unknown";
    return {
      port,
      url: `http://localhost:${port}/mcp`,
      host,
      version: body.version,
      plutoRunning: body.plutoServerRunning,
      plutoUrl: body.plutoUrl,
      sessions: body.activeSessions ?? 0,
    };
  } catch {
    return undefined;
  }
}

export async function probePluto(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<PlutoProbe> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { url, running: /pluto/i.test(text) };
  } catch {
    return { url, running: false };
  }
}

export interface DiscoverOptions {
  port: number;
  /** When true only `port` is probed; otherwise nearby ports are also tried inside VS Code. */
  explicit: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Locate a running tool server. The configured port wins when something
 * answers there. Otherwise, inside VS Code, the extension may have moved up
 * a few ports because its default was busy, so a small range above the
 * base port is probed and a server owned by VS Code is preferred.
 */
export async function discoverMcp(
  opts: DiscoverOptions
): Promise<McpProbe | undefined> {
  const onPort = await probeMcp(opts.port);
  if (onPort) return onPort;
  if (opts.explicit || !isInsideVSCode(opts.env)) return undefined;

  const ports = Array.from(
    { length: VSCODE_PORT_SPREAD },
    (_, i) => opts.port + 1 + i
  );
  const probes = await Promise.all(ports.map((p) => probeMcp(p)));
  const found = probes.filter((p): p is McpProbe => p !== undefined);
  return found.find((p) => p.host === "vscode") ?? found[0];
}

export async function collectStatus(opts: {
  mcpPort: number;
  mcpPortExplicit: boolean;
  plutoPort: number;
  plutoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<Status> {
  const plutoUrl = opts.plutoUrl ?? `http://localhost:${opts.plutoPort}`;
  const [pluto, mcp] = await Promise.all([
    probePluto(plutoUrl),
    discoverMcp({
      port: opts.mcpPort,
      explicit: opts.mcpPortExplicit,
      env: opts.env,
    }),
  ]);
  return {
    insideVSCode: isInsideVSCode(opts.env),
    pluto,
    mcp,
    mcpPort: opts.mcpPort,
  };
}

export function describeHost(host: McpHost): string {
  switch (host) {
    case "vscode":
      return "VS Code extension";
    case "cli":
      return "npx @plutojl/cli run";
    default:
      return "tool server";
  }
}
