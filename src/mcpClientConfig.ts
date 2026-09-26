/**
 * The `pluto-notebook` entry in an MCP client's JSON config, and the rule for
 * merging it into a config file someone else may also be editing. No I/O:
 * callers read the file, hand over its text, and write back what they get.
 */

export interface JsonObject {
  [key: string]: unknown;
}

export const MCP_SERVER_NAME = "pluto-notebook";

/**
 * Claude Code (`.mcp.json`, `~/.claude.json`) lists servers under
 * `mcpServers`; VS Code (`.vscode/mcp.json`) under `servers`, beside an
 * `inputs` array.
 */
export type McpClientFormat = "claude-code" | "vscode";

const FORMATS: Record<
  McpClientFormat,
  { serversKey: string; defaults: JsonObject }
> = {
  "claude-code": { serversKey: "mcpServers", defaults: {} },
  vscode: { serversKey: "servers", defaults: { inputs: [] } },
};

export function mcpEndpointUrl(port: number): string {
  return `http://localhost:${port}/mcp`;
}

/** The tool server speaks streamable HTTP on `/mcp`, with a legacy SSE fallback on the same endpoint. */
export function mcpServerEntry(url: string): JsonObject {
  return { type: "http", url };
}

export type ParsedConfig =
  { ok: true; config: JsonObject } | { ok: false; reason: string };

/** `undefined` stands for a missing file, which is an empty config. */
export function parseMcpClientConfig(raw: string | undefined): ParsedConfig {
  if (raw === undefined) return { ok: true, config: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (e) {
    return {
      ok: false,
      reason: `is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "must contain a JSON object" };
  }
  return { ok: true, config: parsed as JsonObject };
}

export type UpsertResult =
  /** `text` is the merged config, ready to write. */
  | { kind: "updated"; config: JsonObject; text: string }
  /** An entry is already there and `force` was not set; `current` says whether it equals the requested one. */
  | { kind: "exists"; current: boolean }
  /** The config is not a JSON object with an object server map; the file must be left alone. */
  | { kind: "invalid"; reason: string };

export function hasMcpServerEntry(
  config: JsonObject,
  format: McpClientFormat
): boolean {
  const servers = config[FORMATS[format].serversKey];
  return isObject(servers) && servers[MCP_SERVER_NAME] !== undefined;
}

/**
 * Put the `pluto-notebook` entry into `raw`, keeping every other key and
 * server. An existing entry is replaced only with `force`.
 */
export function upsertMcpServer(
  raw: string | undefined,
  opts: { format: McpClientFormat; url: string; force?: boolean }
): UpsertResult {
  const parsed = parseMcpClientConfig(raw);
  if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };

  const { serversKey, defaults } = FORMATS[opts.format];
  const config = parsed.config;
  const entry = mcpServerEntry(opts.url);
  const servers = config[serversKey];
  if (servers !== undefined && !isObject(servers)) {
    return {
      kind: "invalid",
      reason: `has a "${serversKey}" that is not a JSON object`,
    };
  }

  const existing = servers?.[MCP_SERVER_NAME];
  if (existing !== undefined && !opts.force) {
    return {
      kind: "exists",
      current: sameEntry(existing, entry),
    };
  }

  const merged: JsonObject = {
    ...config,
    [serversKey]: { ...servers, [MCP_SERVER_NAME]: entry },
  };
  for (const [key, value] of Object.entries(defaults)) merged[key] ??= value;
  return {
    kind: "updated",
    config: merged,
    text: JSON.stringify(merged, null, 2) + "\n",
  };
}

/** Entries are flat string maps; key order is irrelevant. */
function sameEntry(existing: unknown, entry: JsonObject): boolean {
  if (!isObject(existing)) return false;
  const keys = Object.keys(entry);
  return (
    Object.keys(existing).length === keys.length &&
    keys.every((key) => existing[key] === entry[key])
  );
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
