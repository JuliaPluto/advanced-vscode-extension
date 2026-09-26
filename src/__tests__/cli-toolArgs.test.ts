import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  checkToolArgs,
  readToolArgsSource,
  resolvePathArgs,
  withCodeFile,
} from "../cli/toolArgs.ts";
import type { ToolInfo } from "../cli/toolClient.ts";

const readCellOutput: ToolInfo = {
  name: "read_cell_output",
  inputSchema: {
    properties: {
      path: { type: "string", "x-pluto-path": true },
      cell_id: { type: "string" },
      as: { type: "string", enum: ["text", "file", "image"] },
      output_path: { type: "string", "x-pluto-path": true },
      label: { type: "string" },
    },
    required: ["path", "cell_id"],
  },
};

describe("resolvePathArgs", () => {
  const cwd = path.join(os.tmpdir(), "proj");

  it("resolves exactly the arguments the schema marks as paths", () => {
    expect(
      resolvePathArgs(
        {
          path: "scripts/nb.pluto.jl",
          output_path: "out/x.png",
          cell_id: "c",
          label: "rel/not/a/path",
        },
        readCellOutput,
        cwd
      )
    ).toEqual({
      path: path.join(cwd, "scripts/nb.pluto.jl"),
      output_path: path.join(cwd, "out/x.png"),
      cell_id: "c",
      label: "rel/not/a/path",
    });
  });

  it("leaves absolute paths, empty strings, and non-strings alone", () => {
    const args = { path: "/abs/nb.jl", output_path: "", cell_id: 42 };
    expect(resolvePathArgs(args, readCellOutput, cwd)).toEqual(args);
  });

  it("resolves nothing for a tool without marked arguments", () => {
    expect(resolvePathArgs({ path: "nb.jl" }, { name: "x" }, cwd)).toEqual({
      path: "nb.jl",
    });
  });
});

describe("checkToolArgs", () => {
  it("accepts arguments that match the schema", () => {
    expect(
      checkToolArgs(
        { path: "/nb.jl", cell_id: "c", as: "file" },
        readCellOutput
      )
    ).toEqual([]);
  });

  it("names unknown and missing arguments", () => {
    expect(
      checkToolArgs({ path: "/nb.jl", url: "http://x" }, readCellOutput)
    ).toEqual(["unknown argument url", "missing required argument cell_id"]);
  });

  it("names wrong types and values outside an enum", () => {
    expect(
      checkToolArgs({ path: 1, cell_id: "c", as: "png" }, readCellOutput)
    ).toEqual([
      "path must be a string, got number",
      'as must be one of "text", "file", "image", got "png"',
    ]);
  });

  it("checks array items, numbers and booleans", () => {
    const moveCells: ToolInfo = {
      name: "move_cells",
      inputSchema: {
        properties: {
          cell_ids: { type: "array", items: { type: "string" } },
          index: { type: "number" },
          run: { type: "boolean" },
        },
      },
    };
    expect(
      checkToolArgs({ cell_ids: ["a", 2], index: "0", run: "yes" }, moveCells)
    ).toEqual([
      "cell_ids[1] must be a string, got number",
      "index must be a number, got string",
      "run must be a boolean, got string",
    ]);
    expect(
      checkToolArgs({ cell_ids: ["a"], index: 0, run: true }, moveCells)
    ).toEqual([]);
  });

  it("rejects every argument of a tool that takes none", () => {
    expect(checkToolArgs({ port: 1234 }, { name: "start" })).toEqual([
      "unknown argument port",
    ]);
  });
});

describe("readToolArgsSource", () => {
  it("returns inline JSON unchanged", () => {
    expect(readToolArgsSource('{"a":1}', "/")).toBe('{"a":1}');
  });

  it("reads @file relative to cwd", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plutocli-args-"));
    try {
      fs.writeFileSync(path.join(dir, "args.json"), '{"path":"nb.jl"}');
      expect(readToolArgsSource("@args.json", dir)).toBe('{"path":"nb.jl"}');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a lone @ as inline text", () => {
    expect(readToolArgsSource("@", "/")).toBe("@");
  });
});

describe("withCodeFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "plutocli-code-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sets code from the file relative to cwd, without its final newline", () => {
    const code = 'begin\n\t@bind x Slider(1:10)\n\t"say \\"hi\\""\nend\n';
    fs.writeFileSync(path.join(dir, "cell.jl"), code);
    expect(withCodeFile({ path: "/nb.jl" }, "cell.jl", dir)).toEqual({
      path: "/nb.jl",
      code: code.slice(0, -1),
    });
  });

  it("keeps blank lines the cell ends with, before the final newline", () => {
    fs.writeFileSync(path.join(dir, "cell.jl"), "x = 1\r\n\r\n");
    expect(withCodeFile({}, "cell.jl", dir).code).toBe("x = 1\r\n");
  });

  it("refuses when the arguments already carry code", () => {
    fs.writeFileSync(path.join(dir, "cell.jl"), "1");
    expect(() => withCodeFile({ code: "2" }, "cell.jl", dir)).toThrow(
      /not both/
    );
  });

  it("reports a missing file", () => {
    expect(() => withCodeFile({}, "missing.jl", dir)).toThrow(/ENOENT/);
  });
});
