import { parseArgs, UsageError } from "../cli/parseArgs.ts";

describe("parseArgs", () => {
  it("defaults to help with no arguments", () => {
    expect(parseArgs([])).toEqual({ command: "help" });
  });

  it("treats --help and --version as commands wherever they appear", () => {
    expect(parseArgs(["run", "--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["call", "x", "-V"]).command).toBe("version");
  });

  it("parses run options", () => {
    expect(
      parseArgs([
        "run",
        "--pluto-port",
        "4321",
        "--mcp-port=3200",
        "--julia-version",
        "default",
        "--no-pluto",
        "--update",
      ])
    ).toEqual({
      command: "run",
      plutoPort: 4321,
      mcpPort: 3200,
      juliaVersion: "default",
      noPluto: true,
      update: true,
    });
  });

  it("accepts call positionals before or after flags", () => {
    const before = parseArgs([
      "call",
      "open_notebook",
      '{"path":"x"}',
      "--raw",
    ]);
    const after = parseArgs(["call", "--raw", "open_notebook", '{"path":"x"}']);
    const between = parseArgs([
      "call",
      "open_notebook",
      "--raw",
      '{"path":"x"}',
    ]);
    for (const args of [before, after, between]) {
      expect(args).toEqual({
        command: "call",
        toolName: "open_notebook",
        toolArgs: '{"path":"x"}',
        raw: true,
      });
    }
  });

  it("parses tools [name]", () => {
    expect(parseArgs(["tools"])).toEqual({
      command: "tools",
      toolFilter: undefined,
    });
    expect(parseArgs(["tools", "open_notebook"]).toolFilter).toBe(
      "open_notebook"
    );
    expect(() => parseArgs(["tools", "a", "b"])).toThrow(UsageError);
  });

  it("rejects unknown commands and options", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow(
      /Unknown command 'frobnicate'/
    );
    expect(() => parseArgs(["run", "--pluto_port", "5000"])).toThrow(
      /Unknown option '--pluto_port'/
    );
  });

  it("rejects options that do not belong to the command", () => {
    expect(() => parseArgs(["run", "--raw"])).toThrow(/not valid for 'run'/);
    expect(() => parseArgs(["tools", "--force"])).toThrow(
      /not valid for 'tools'/
    );
  });

  it("validates values", () => {
    expect(() => parseArgs(["run", "--pluto-port", "abc"])).toThrow(
      /port number/
    );
    expect(() => parseArgs(["run", "--pluto-port", "70000"])).toThrow(
      /port number/
    );
    expect(() => parseArgs(["run", "--pluto-port"])).toThrow(
      /requires a value/
    );
    expect(() => parseArgs(["call", "x", "--timeout", "0"])).toThrow(/seconds/);
    expect(() => parseArgs(["install", "--target", "cursor"])).toThrow(
      /--target expects/
    );
    expect(() => parseArgs(["run", "--no-pluto=yes"])).toThrow(
      /does not take a value/
    );
  });

  it("requires a tool name for call and rejects extra positionals", () => {
    expect(() => parseArgs(["call"])).toThrow(/call needs a tool name/);
    expect(() => parseArgs(["call", "a", "b", "c"])).toThrow(/at most two/);
    expect(() => parseArgs(["run", "extra"])).toThrow(
      /does not take arguments/
    );
  });

  it("passes everything after -- as positionals", () => {
    expect(parseArgs(["call", "--", "tool", "--not-a-flag"])).toEqual({
      command: "call",
      toolName: "tool",
      toolArgs: "--not-a-flag",
    });
  });
});
