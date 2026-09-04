import { jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  copilotConfigPath,
  hasMcpConfig,
  installMcpConfig,
} from "../cli/install.ts";

describe("installMcpConfig", () => {
  let cwd: string;
  let home: string;
  let log: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "plutocli-install-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "plutocli-home-"));
    log = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const base = { mcpPort: 3100, global: false, dryRun: false, force: false };

  it("writes Claude Code config to .mcp.json and Copilot config to .vscode/mcp.json", () => {
    installMcpConfig({ ...base, target: "all" }, cwd, home);

    const claude = JSON.parse(
      fs.readFileSync(path.join(cwd, ".mcp.json"), "utf-8")
    );
    expect(claude.mcpServers["pluto-notebook"]).toEqual({
      type: "http",
      url: "http://localhost:3100/mcp",
    });

    const copilot = JSON.parse(
      fs.readFileSync(copilotConfigPath(cwd), "utf-8")
    );
    expect(copilotConfigPath(cwd)).toBe(path.join(cwd, ".vscode", "mcp.json"));
    expect(copilot.servers["pluto-notebook"].url).toBe(
      "http://localhost:3100/mcp"
    );
    expect(copilot.inputs).toEqual([]);
    expect(hasMcpConfig(cwd, home)).toBe(true);
  });

  it("keeps other servers and does not replace an existing entry without --force", () => {
    fs.writeFileSync(
      path.join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          other: { type: "stdio", command: "x" },
          "pluto-notebook": { type: "http", url: "http://localhost:9999/mcp" },
        },
      })
    );
    installMcpConfig({ ...base, target: "claude-code" }, cwd, home);
    let claude = JSON.parse(
      fs.readFileSync(path.join(cwd, ".mcp.json"), "utf-8")
    );
    expect(claude.mcpServers["pluto-notebook"].url).toBe(
      "http://localhost:9999/mcp"
    );

    installMcpConfig(
      { ...base, target: "claude-code", force: true },
      cwd,
      home
    );
    claude = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf-8"));
    expect(claude.mcpServers["pluto-notebook"].url).toBe(
      "http://localhost:3100/mcp"
    );
    expect(claude.mcpServers.other).toEqual({ type: "stdio", command: "x" });
  });

  it("does not write anything in dry-run mode", () => {
    installMcpConfig({ ...base, target: "all", dryRun: true }, cwd, home);
    expect(fs.existsSync(path.join(cwd, ".mcp.json"))).toBe(false);
    expect(fs.existsSync(copilotConfigPath(cwd))).toBe(false);
    expect(hasMcpConfig(cwd, home)).toBe(false);
  });

  it("writes --global Claude Code config into the home directory", () => {
    installMcpConfig(
      { ...base, target: "claude-code", global: true },
      cwd,
      home
    );
    const claude = JSON.parse(
      fs.readFileSync(path.join(home, ".claude.json"), "utf-8")
    );
    expect(claude.mcpServers["pluto-notebook"].url).toBe(
      "http://localhost:3100/mcp"
    );
  });

  it("refuses to merge into a config file it cannot parse", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), "{ not json");
    expect(() =>
      installMcpConfig(
        { ...base, target: "claude-code", global: true },
        cwd,
        home
      )
    ).toThrow(/not valid JSON/);
    expect(fs.readFileSync(path.join(home, ".claude.json"), "utf-8")).toBe(
      "{ not json"
    );
  });

  it("refuses --global for copilot instead of writing a stray file", () => {
    installMcpConfig({ ...base, target: "copilot", global: true }, cwd, home);
    expect(fs.existsSync(copilotConfigPath(cwd))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "mcp.json"))).toBe(false);
  });
});
