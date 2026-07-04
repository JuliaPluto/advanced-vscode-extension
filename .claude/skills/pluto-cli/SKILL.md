---
name: pluto-cli
description: Drive Julia Pluto notebooks from the terminal with npx @plutojl/cli — start a Pluto server, open notebooks, create/edit/execute cells, validate outputs, and export HTML. Use when asked to run, build, validate, or fix a Pluto notebook (.pluto.jl), or to execute Julia code in a reactive notebook context.
---

# Driving Pluto notebooks with @plutojl/cli

The CLI has four subcommands: `run` (start Pluto + the tool server), `tools` (list notebook tools), `call <tool> [json]` (invoke one), and `install` (write MCP config for AI assistants). You mostly need `run` once, then `call` for everything.

## Start the servers (once)

```bash
npx @plutojl/cli run          # starts Pluto + tool server on :3100
# or, if a Pluto server is already running:
npx @plutojl/cli run --pluto-url http://localhost:1234
```

Run this in the background — it stays up. First run installs and precompiles Pluto: **allow up to 10 minutes**; the tool server's `/health` endpoint responds throughout. Check readiness with:

```bash
curl -s http://localhost:3100/health   # {"status":"ok","plutoServerRunning":true,...}
```

## The validation loop (the main workflow)

Hand-write or edit the `.pluto.jl` file BEFORE opening it (fastest for multi-cell authoring — see `learn_pluto_basics` for the exact file format), then use the notebook as your correctness oracle:

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
- Passing large code through `call`'s JSON argument fights shell escaping — for multi-line cells, write the `.jl` file and `open_notebook`, or pipe carefully quoted JSON.
- `call --timeout <seconds>` raises the client-side wait (default 120s); `--raw` prints the raw JSON response.

## Finishing

```bash
npx @plutojl/cli call save_notebook '{"path": "/abs/path/nb.pluto.jl"}'
npx @plutojl/cli call export_notebook_html '{"path": "/abs/path/nb.pluto.jl"}'
npx @plutojl/cli call get_notebook_url '{"path": "/abs/path/nb.pluto.jl"}'   # browser link for the user
```

For the full tool list with parameters: `npx @plutojl/cli tools`. For Pluto file format, reactivity, PlutoUI, and beautification guidance: `call learn_pluto_basics` (or read `src/PLUTO_GUIDE.md` in this repo).
