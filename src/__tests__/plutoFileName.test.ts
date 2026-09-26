import * as fs from "fs";
import {
  PLUTO_NOTEBOOK_EXTENSIONS,
  isPlutoNotebookFileName,
} from "../plutoFileName.ts";

describe("isPlutoNotebookFileName", () => {
  it("matches the notebook selectors declared in package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8")
    );
    const patterns = pkg.contributes.notebooks
      .find((n: { type: string }) => n.type === "pluto-notebook")
      .selector.map((s: { filenamePattern: string }) => s.filenamePattern);
    expect(patterns).toEqual(PLUTO_NOTEBOOK_EXTENSIONS.map((e) => `*.${e}`));
  });

  it.each([
    ["/a/b/nb.pluto.jl", true],
    ["nb.dyad.jl", true],
    ["script.jl", false],
    ["nb.pluto.jl.bak", false],
  ])("%s -> %s", (name, expected) => {
    expect(isPlutoNotebookFileName(name)).toBe(expected);
  });
});
