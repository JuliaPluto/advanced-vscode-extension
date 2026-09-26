import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolveInstallArgs,
  resolveMcpPort,
  resolveRunConfig,
} from "../cli/resolveConfig.ts";
import { DEFAULTS } from "../cli/config.ts";
import type { RawArgs } from "../cli/parseArgs.ts";

describe("resolveConfig", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "plutocli-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("uses defaults and marks the tool-server port as not explicit", () => {
    const config = resolveRunConfig({ command: "run" }, { cwd, env: {} });
    expect(config.mcpPort).toBe(DEFAULTS.mcpPort);
    expect(config.mcpPortExplicit).toBe(false);
    expect(config.plutoPort).toBe(DEFAULTS.plutoPort);
    expect(config.juliaVersion).toBe(DEFAULTS.juliaVersion);
    expect(config.juliaVersionExplicit).toBe(false);
    expect(config.update).toBe(false);
  });

  it("marks ports from config files as a starting point, not explicit", () => {
    fs.writeFileSync(
      path.join(cwd, ".plutomcp.json"),
      JSON.stringify({ mcpPort: 3300 })
    );
    expect(resolveMcpPort({ command: "tools" }, { cwd, env: {} })).toEqual({
      port: 3300,
      explicit: false,
    });
    expect(
      resolveMcpPort(
        { command: "tools" },
        { cwd, env: { PLUTO_MCP_PORT: "3400" } }
      )
    ).toEqual({ port: 3400, explicit: true });
  });

  it("falls back to the VS Code extension's configured port", () => {
    fs.mkdirSync(path.join(cwd, ".vscode"));
    fs.writeFileSync(
      path.join(cwd, ".vscode", "settings.json"),
      JSON.stringify({ "pluto-notebook.mcpPort": 3150 })
    );
    expect(resolveMcpPort({ command: "call" }, { cwd, env: {} })).toEqual({
      port: 3150,
      explicit: false,
    });
  });

  it("applies flag > env > file precedence", () => {
    fs.writeFileSync(
      path.join(cwd, ".plutomcp.json"),
      JSON.stringify({ mcpPort: 3300, plutoPort: 1300, juliaVersion: "1.11" })
    );
    const env = { PLUTO_MCP_PORT: "3200", PLUTO_PORT: "1200" };
    const config = resolveRunConfig(
      { command: "run", mcpPort: 3100 },
      { cwd, env }
    );
    expect(config.mcpPort).toBe(3100);
    expect(config.mcpPortExplicit).toBe(true);
    expect(config.plutoPort).toBe(1200);
    expect(config.juliaVersion).toBe("1.11");
  });

  it("treats a Pluto port or URL from a flag or env as explicit, not from a file", () => {
    fs.writeFileSync(
      path.join(cwd, ".plutomcp.json"),
      JSON.stringify({ plutoPort: 1300, serverUrl: "http://localhost:1300" })
    );
    const explicit = (args: Partial<RawArgs>, env: NodeJS.ProcessEnv = {}) =>
      resolveRunConfig({ command: "status", ...args }, { cwd, env })
        .plutoExplicit;
    expect(explicit({})).toBe(false);
    expect(explicit({ plutoPort: 1235 })).toBe(true);
    expect(explicit({ plutoUrl: "http://localhost:1235" })).toBe(true);
    expect(explicit({}, { PLUTO_PORT: "1235" })).toBe(true);
    expect(explicit({}, { PLUTO_SERVER_URL: "http://localhost:1235" })).toBe(
      true
    );
  });

  it("accepts an http(s) Pluto URL", () => {
    const config = resolveRunConfig(
      { command: "run", plutoUrl: "https://pluto.example:8443/" },
      { cwd, env: {} }
    );
    expect(config.plutoUrl).toBe("https://pluto.example:8443/");
  });

  it("rejects a Pluto URL without a scheme, suggesting http://", () => {
    expect(() =>
      resolveRunConfig(
        { command: "run", plutoUrl: "localhost:1234" },
        { cwd, env: {} }
      )
    ).toThrow("did you mean 'http://localhost:1234'?");
  });

  it.each(["foo", "ftp://host", "http://"])(
    "rejects the Pluto URL '%s'",
    (plutoUrl) => {
      expect(() =>
        resolveRunConfig({ command: "run", plutoUrl }, { cwd, env: {} })
      ).toThrow("--pluto-url");
    }
  );

  it("checks a Pluto URL from the environment too", () => {
    expect(() =>
      resolveRunConfig(
        { command: "run" },
        { cwd, env: { PLUTO_SERVER_URL: "localhost:1234" } }
      )
    ).toThrow("http://");
  });

  it("install reads the tool-server port from .plutomcp.json like every other command", () => {
    fs.writeFileSync(
      path.join(cwd, ".plutomcp.json"),
      JSON.stringify({ mcpPort: 3300 })
    );
    expect(
      resolveInstallArgs({ command: "install" }, { cwd, env: {} }).mcpPort
    ).toBe(3300);
  });
});
