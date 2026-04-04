export interface CliConfig {
  mcpPort: number;
  plutoPort: number;
  plutoUrl: string | undefined;
  juliaVersion: string;
  workDir: string;
  noPluto: boolean;
}

export interface InstallArgs {
  target: "claude-code" | "copilot" | "all";
  mcpPort: number;
  global: boolean;
  dryRun: boolean;
  force: boolean;
}

export const DEFAULTS = {
  mcpPort: 3100,
  plutoPort: 1234,
  juliaVersion: "1.11.7",
} as const;
