---
description: Build a Pluto notebook under ./scripts with @plutojl/cli, inside this Julia project (local package, environment cell, absolute paths)
---

Build a Pluto notebook at ./scripts/$ARGUMENTS using the @plutojl/cli tool (`npx @plutojl/cli`). If no name was given, pick a short descriptive one ending in `.pluto.jl`.

Ground rules:

1. Run `npx @plutojl/cli call learn_pluto_basics` first and follow it. In particular read "Notebooks inside a Julia project" — this notebook lives inside a Julia package.
2. Always pass ABSOLUTE paths to the tool: build them with `joinpath(pwd(), "scripts", "<name>.pluto.jl")` (or `$PWD/scripts/...` in a shell), never `./scripts/...`.
3. Create the file with `call create_notebook` (path + title). Do not hand-write the file.
4. First cell = the environment cell, exactly one `begin ... end` block:

   ```julia
   begin
       import Pkg
       Pkg.activate(mktempdir())
       Pkg.develop(path = joinpath(@__DIR__, ".."))
       Pkg.add(["Plots", "PlutoUI"])
       using <ThisPackage>, Plots, PlutoUI
   end
   ```

   Never `Pkg.add` into the project's own Project.toml. After editing this cell, call `wait_for_notebook_idle` before doing anything else; it can take minutes.

5. Put cell code in a JSON file and pass it as `call create_cell @/abs/path/args.json` instead of quoting Julia inside a shell string.
6. One definition per variable across the whole notebook; use `begin ... end` for multi-statement cells.
7. Check every result: `errored` must be false. For plots, look at them with `call read_cell_output '{"path": ..., "cell_id": ..., "as": "image"}'` and describe what you see.
8. Finish with `list_cells` (no errored cells), `save_notebook`, and `get_notebook_url` for the user.
