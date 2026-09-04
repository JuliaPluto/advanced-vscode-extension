export interface CliConfig {
  mcpPort: number;
  /** True when the tool-server port came from a flag, env var, or config file. */
  mcpPortExplicit: boolean;
  plutoPort: number;
  plutoUrl: string | undefined;
  /** juliaup channel, or "default" to use whatever `julia` resolves to. */
  juliaVersion: string;
  /** True when the channel was named by the user rather than defaulted. */
  juliaVersionExplicit: boolean;
  workDir: string;
  noPluto: boolean;
  /** Re-run the Pluto install/precompile step even when Pluto is already installed. */
  update: boolean;
}

export interface InstallArgs {
  target: "claude-code" | "copilot" | "all";
  mcpPort: number;
  global: boolean;
  dryRun: boolean;
  force: boolean;
}

/** Injected by esbuild from packages/advanced-pluto-mcp/package.json; "dev" when unbundled. */
declare const __CLI_VERSION__: string | undefined;

export const VERSION: string =
  typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "dev";

export const DEFAULTS = {
  mcpPort: 3100,
  plutoPort: 1234,
  juliaVersion: "1.12.7",
} as const;

export const CONFIG_FILE = ".plutomcp.json";
