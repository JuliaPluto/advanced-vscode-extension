---
name: pluto-cli
description: Drive Julia Pluto notebooks from the terminal with npx @plutojl/cli — start a Pluto server, open notebooks, create/edit/execute cells, validate outputs, and export HTML. Use when asked to run, build, validate, or fix a Pluto notebook (.pluto.jl), or to execute Julia code in a reactive notebook context.
---

# Driving Pluto notebooks with @plutojl/cli

The CLI has these subcommands: `status` (what is running), `run` (start Pluto + the tool server), `tools [name]` (list notebook tools, or one tool's parameters), `call <tool> [json]` (invoke one), and `install` (write MCP config for AI assistants). You mostly need `run` once, then `call` for everything.

## Check first, then start the servers (once)

```bash
npx @plutojl/cli status       # is Pluto (:1234) or a tool server already up?
```

Inside VS Code the Advanced Pluto Notebook extension usually already runs a tool server; `status`, `tools`, and `call` find it automatically (even on a nearby port), so there is nothing to start. Otherwise:

```bash
npx @plutojl/cli run          # starts Pluto + tool server on :3100
# or, if a Pluto server is already running:
npx @plutojl/cli run --pluto-url http://localhost:1234
```

Run this in the background — it stays up. First run installs and precompiles Pluto: **allow up to 10 minutes**; later runs skip the install (pass `--update` to force it). The tool server's `/health` endpoint responds throughout. Check readiness with:

```bash
npx @plutojl/cli status --wait         # blocks until Pluto is connected (up to --timeout, default 600s)
curl -s http://localhost:3100/health   # {"status":"ok","host":"cli","plutoServerRunning":true,...}
```

## The validation loop (the main workflow)

Start from `create_notebook` (`{"path": "/abs/path/nb.pluto.jl", "title": "My notebook"}`) and add cells with `create_cell`, or hand-write the `.pluto.jl` file BEFORE opening it (fastest for multi-cell authoring — see `learn_pluto_basics` for the exact file format). Then use the notebook as your correctness oracle:

```bash
npx @plutojl/cli call open_notebook '{"path": "/abs/path/nb.pluto.jl"}'
npx @plutojl/cli call wait_for_notebook_idle '{"path": "/abs/path/nb.pluto.jl"}'
npx @plutojl/cli call list_cells '{"path": "/abs/path/nb.pluto.jl"}'
```

- `open_notebook` parses, instantiates, and runs every cell. If the notebook is already open (e.g. the user's browser tab), you attach to that session.
- `wait_for_notebook_idle` blocks until nothing is running or queued. **Use it instead of polling `list_cells` in a loop.**
- `list_cells` shows `errored`/`running`/`queued` per cell — find the failing cell, then `read_cell` for its output, `edit_cell` to fix, and repeat.

## Rules that save you from confusing failures

- **One definition per variable across the whole notebook** (Pluto reactivity). "Multiple definitions" → `list_cells`, find the duplicate, `delete_cell`.
- Execution tools (`create_cell`, `execute_cell`, `execute_code`) return after 5 minutes with `timed_out: true` if the cell is still computing — the computation continues; follow with `wait_for_notebook_idle`. **Never retry a timed-out `create_cell`** — the cell exists.
- Notebooks are **not auto-saved**: call `save_notebook` to persist. Never edit the `.pluto.jl` on disk while it's open — Pluto owns the file.
- Prefer plain `using PackageName` — Pluto installs packages automatically.
- Long/slow cells: `edit_cell` with `run: false`, then `execute_cell`, then `wait_for_notebook_idle`.
- Passing large code through `call`'s JSON argument fights shell escaping — write the arguments to a file and pass `@args.json`, or pipe JSON on stdin with `-`.
- Notebook inside a Julia project that needs the local package? One environment cell: `Pkg.activate(mktempdir()); Pkg.develop(path=joinpath(@__DIR__, ".."))`, then the `using` lines in the same cell. Never `Pkg.add` into the user's project. `@__DIR__` is the notebook's directory; `pwd()` is not. Details: `call learn_pluto_basics`.
- `call --timeout <seconds>` raises the client-side wait (default 120s); `--raw` prints the raw JSON response.
- Cell results summarize outputs (images come back as a size only). To see a plot: `call read_cell_output '{"path": ..., "cell_id": ..., "as": "image"}'` saves a PNG (`--out <file>` to name it) that you can Read; `"as": "file"` writes the original output next to the notebook; `"as": "text"` returns full markup or long text.

## Finishing

```bash
npx @plutojl/cli call save_notebook '{"path": "/abs/path/nb.pluto.jl"}'
npx @plutojl/cli call export_notebook_html '{"path": "/abs/path/nb.pluto.jl"}'
npx @plutojl/cli call get_notebook_url '{"path": "/abs/path/nb.pluto.jl"}'   # browser link for the user
```

For the full tool list: `npx @plutojl/cli tools`; for one tool's parameters and an example call: `npx @plutojl/cli tools <name>`. For Pluto file format, reactivity, PlutoUI, and beautification guidance: `call learn_pluto_basics` (or read `src/PLUTO_GUIDE.md` in this repo).
