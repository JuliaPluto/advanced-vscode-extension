import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readToolArgsSource, resolvePathArgs } from "../cli/toolArgs.ts";

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
