import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  readToolArgsSource,
  resolvePathArgs,
  withCodeFile,
} from "../cli/toolArgs.ts";

describe("resolvePathArgs", () => {
  const cwd = path.join(os.tmpdir(), "proj");

  it("resolves relative notebook and output paths against cwd", () => {
    expect(
      resolvePathArgs(
        { path: "scripts/nb.pluto.jl", output_path: "out/x.png", cell_id: "c" },
        cwd
      )
    ).toEqual({
      path: path.join(cwd, "scripts/nb.pluto.jl"),
      output_path: path.join(cwd, "out/x.png"),
      cell_id: "c",
    });
  });

  it("leaves absolute paths, empty strings, and non-strings alone", () => {
    const args = { path: "/abs/nb.jl", new_path: "", code: 42 };
    expect(resolvePathArgs(args, cwd)).toEqual(args);
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
