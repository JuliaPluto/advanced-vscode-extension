import { plutoBootstrap } from "../server/bootstrap.ts";

describe("plutoBootstrap", () => {
  const extension = plutoBootstrap({
    port: 1234,
    update: true,
    writeNotebookFiles: false,
  });
  const cli = plutoBootstrap({
    port: 1234,
    update: false,
    writeNotebookFiles: true,
  });

  it("leaves notebook files to the editor only when asked", () => {
    expect(extension).toContain("disable_writing_notebook_files=true");
    expect(cli).not.toContain("disable_writing_notebook_files");
  });

  it("installs and precompiles on update, otherwise only when Pluto is missing", () => {
    expect(extension).toContain(
      "if true || !haskey(Pkg.project().dependencies, s(:Pluto))"
    );
    expect(extension).toContain("if true;Pkg.precompile();end");
    expect(cli).toContain(
      "if false || !haskey(Pkg.project().dependencies, s(:Pluto))"
    );
    expect(cli).toContain("if false;Pkg.precompile();end");
  });

  it("is one program for both hosts apart from the named options", () => {
    const normalize = (program: string) =>
      program
        .replace(/if (true|false)/g, "if UPDATE")
        .replace(", disable_writing_notebook_files=true", "");
    expect(normalize(extension)).toBe(normalize(cli));
  });

  it("serves on the given port without a browser or secrets", () => {
    expect(
      plutoBootstrap({ port: 1240, update: false, writeNotebookFiles: true })
    ).toMatch(
      /Pluto\.run\(port=1240; require_secret_for_open_links=false, require_secret_for_access=false, launch_browser=false\)$/
    );
  });
});
