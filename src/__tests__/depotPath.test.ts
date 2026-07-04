import { resolveJuliaDepotPath, isWindows } from "../platformUtils.js";
import * as os from "os";
import * as path from "path";

describe("resolveJuliaDepotPath", () => {
  const originalDepot = process.env.JULIA_DEPOT_PATH;
  const separator = isWindows() ? ";" : ":";

  afterEach(() => {
    if (originalDepot === undefined) {
      delete process.env.JULIA_DEPOT_PATH;
    } else {
      process.env.JULIA_DEPOT_PATH = originalDepot;
    }
  });

  it("defaults to the home depot when unset", () => {
    delete process.env.JULIA_DEPOT_PATH;
    expect(resolveJuliaDepotPath()).toBe(path.join(os.homedir(), ".julia"));
  });

  it("expands a leading ~ to the home directory (issue #34)", () => {
    process.env.JULIA_DEPOT_PATH = "~/.julia";
    expect(resolveJuliaDepotPath()).toBe(path.join(os.homedir(), ".julia"));
  });

  it("respects an existing absolute depot path", () => {
    const custom = path.join(os.homedir(), "custom-depot");
    process.env.JULIA_DEPOT_PATH = custom;
    expect(resolveJuliaDepotPath()).toBe(custom);
  });

  it("preserves multi-entry depot paths, expanding each ~", () => {
    const custom = path.join(os.homedir(), "custom-depot");
    process.env.JULIA_DEPOT_PATH = ["~/depot-a", custom].join(separator);
    expect(resolveJuliaDepotPath()).toBe(
      [path.join(os.homedir(), "depot-a"), custom].join(separator)
    );
  });

  it("falls back to the home depot for relative entries", () => {
    process.env.JULIA_DEPOT_PATH = "relative/depot";
    expect(resolveJuliaDepotPath()).toBe(path.join(os.homedir(), ".julia"));
  });
});
