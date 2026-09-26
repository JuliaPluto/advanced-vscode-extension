export interface BootstrapOptions {
  port: number;
  /** Re-resolve and precompile Pluto; otherwise install only when it is missing. */
  update: boolean;
  /** Whether Pluto writes notebook files after every run. */
  writeNotebookFiles: boolean;
}

/**
 * The Julia program that makes sure Pluto is present in the shared
 * environment and then serves it. Pkg.instantiate() always runs so a
 * pruned depot is repaired.
 */
export function plutoBootstrap(options: BootstrapOptions): string {
  const update = options.update ? "true" : "false";
  const runOptions = [
    "require_secret_for_open_links=false",
    "require_secret_for_access=false",
    "launch_browser=false",
    ...(options.writeNotebookFiles
      ? []
      : ["disable_writing_notebook_files=true"]),
  ].join(", ");
  return [
    `println("Julia ", VERSION, " at ", Sys.BINDIR)`,
    "import Pkg",
    "s = string",
    "env = mkpath(joinpath(Pkg.depots1(), s(:environments), s(:vscode_pluto_notebook), string(VERSION)))",
    "Pkg.activate(env)",
    `if ${update} || !haskey(Pkg.project().dependencies, s(:Pluto))`,
    "Pkg.Registry.add()",
    "Pkg.add(s(:Pluto))",
    "Pkg.add(s(:Pkg))",
    "end",
    "Pkg.instantiate()",
    `if ${update}`,
    "Pkg.precompile()",
    "end",
    "using Pluto",
    `Pluto.run(port=${options.port}; ${runOptions})`,
  ].join(";");
}
