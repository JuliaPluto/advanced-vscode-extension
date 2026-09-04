import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolveInstallArgs,
  resolveMcpPort,
  resolveRunConfig,
} from "../cli/resolveConfig.ts";
import { DEFAULTS } from "../cli/config.ts";

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
    expect(config.update).toBe(false);
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

  it("install reads the tool-server port from .plutomcp.json like every other command", () => {
    fs.writeFileSync(
      path.join(cwd, ".plutomcp.json"),
      JSON.stringify({ mcpPort: 3300 })
    );
    expect(resolveMcpPort({ command: "tools" }, { cwd, env: {} })).toEqual({
      port: 3300,
      explicit: true,
    });
    expect(resolveInstallArgs({ command: "install" }, { cwd, env: {} }).mcpPort).toBe(
      3300
    );
  });
});
