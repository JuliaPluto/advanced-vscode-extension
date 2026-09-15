import { commandUsesJuliaupChannel } from "../platformUtils.js";

describe("commandUsesJuliaupChannel", () => {
  const depot = "/home/me/.julia/juliaup-depots/juliahub.com/juliaup";

  it("accepts the channel passed as a +channel argument", () => {
    expect(commandUsesJuliaupChannel("dyad-3.3.0", "julia +dyad-3.3.0")).toBe(
      true
    );
  });

  it("accepts the channel resolved to its juliaup install directory", () => {
    expect(
      commandUsesJuliaupChannel(
        "dyad-3.3.0",
        `${depot}/julia-1.12.7+dyad-3x3x0.x64.linux.musl/bin/julia`
      )
    ).toBe(true);
  });

  it("accepts a pre-release channel under its directory spelling", () => {
    expect(
      commandUsesJuliaupChannel(
        "dyad-3.4.0-rc1",
        `${depot}/julia-1.12.7+dyad-3x4x0-rc1.x64.linux.musl/bin/julia`
      )
    ).toBe(true);
  });

  it("rejects a different dyad channel", () => {
    expect(
      commandUsesJuliaupChannel(
        "dyad-3.3.0",
        `${depot}/julia-1.12.7+dyad-3x4x0-rc1.x64.linux.musl/bin/julia`
      )
    ).toBe(false);
  });

  it("rejects a plain Julia install without the channel", () => {
    expect(
      commandUsesJuliaupChannel(
        "dyad-3.3.0",
        `${depot}/julia-1.12.7+0.x64.linux.gnu/bin/julia`
      )
    ).toBe(false);
    expect(commandUsesJuliaupChannel("dyad-3.3.0", "/usr/bin/julia")).toBe(
      false
    );
  });
});
