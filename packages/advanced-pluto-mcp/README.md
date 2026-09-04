# @plutojl/cli

Command-line tool for [Pluto.jl](https://plutojl.org/) notebooks. Start a Pluto server and drive notebooks straight from your terminal — open notebooks, create and execute cells, read outputs. The tool server it starts also speaks MCP (Model Context Protocol), so AI assistants like Claude and GitHub Copilot can use the same tools.

## Quick Start

```bash
# See what is running and how to use the CLI
npx @plutojl/cli

# Start Pluto and the tool server
npx @plutojl/cli run

# In another terminal: drive notebooks from the command line
npx @plutojl/cli tools
npx @plutojl/cli call open_notebook '{"path": "notebook.pluto.jl"}'
npx @plutojl/cli call execute_code '{"code": "1 + 1"}'

# Optional: install MCP config so AI assistants can connect too
npx @plutojl/cli install
```

Running with no arguments prints the help followed by a status block that says whether a Pluto server (port 1234) and a tool server are running, and who owns the tool server.

## Inside VS Code

The [Advanced Pluto Notebook](https://marketplace.visualstudio.com/items?itemName=juliapluto-pankgeorg.advanced-vscode-extension) extension runs the same tool server automatically. When the CLI runs inside a VS Code terminal (or from an agent launched there), `tools` and `call` find and use that server, including when the extension had to move to a nearby port because the default was busy. `run` notices it too and tells you nothing needs starting; pass `--mcp-port` to run a separate server anyway.

## Prerequisites

- **Node.js** >= 18
- **Julia** — install from [julialang.org](https://julialang.org/downloads/) or via [juliaup](https://github.com/JuliaLang/juliaup)
- **Pluto.jl** — installed automatically on first run

## Commands

### `run`

Start Pluto and the tool server. Pluto is installed into a shared Julia environment on the first run; later runs skip the install unless `--update` is passed.

```bash
npx @plutojl/cli run [options]
```

| Option                  | Default  | Description                                                          |
| ----------------------- | -------- | -------------------------------------------------------------------- |
| `--mcp-port <port>`     | `3100`   | Tool server (MCP) port                                               |
| `--pluto-port <port>`   | `1234`   | Pluto server port                                                    |
| `--pluto-url <url>`     | —        | Connect to existing Pluto server (skip starting one)                 |
| `--julia-version <ver>` | `1.12.7` | juliaup channel to use, or `default` for whatever `julia` resolves to |
| `--update`              | —        | Re-install and precompile Pluto before starting                      |
| `--no-pluto`            | —        | Start the tool server only, without starting Pluto                   |

### `status`

Show whether Pluto and a tool server are running. Exits 0 when a tool server was found, 1 otherwise. `--json` prints the same information as JSON.

```bash
npx @plutojl/cli status [--json] [--mcp-port <port>] [--pluto-port <port>]
```

### `tools`

List the notebook tools available on a running server, or show one tool's parameters.

```bash
npx @plutojl/cli tools [name] [--mcp-port <port>]
```

### `call`

Call a notebook tool from the command line. The tool name and JSON arguments may appear before or after the options.

```bash
npx @plutojl/cli call <tool_name> [json_args] [options]

# Examples
npx @plutojl/cli call get_notebook_status
npx @plutojl/cli call open_notebook '{"path": "/tmp/nb.pluto.jl"}'
npx @plutojl/cli call execute_code '{"code": "sqrt(2)"}'
```

| Option                | Default | Description                              |
| --------------------- | ------- | ---------------------------------------- |
| `--mcp-port <port>`   | `3100`  | Tool server (MCP) port                   |
| `--timeout <seconds>` | `120`   | How long to wait for the tool result     |
| `--raw`               | —       | Output raw JSON response                 |

### `install`

Add MCP configuration files so AI assistants can connect to the tool server.

```bash
npx @plutojl/cli install [options]
```

| Option              | Default       | Description                                                    |
| ------------------- | ------------- | -------------------------------------------------------------- |
| `--target <target>` | `claude-code` | Config target: `claude-code`, `copilot`, or `all`              |
| `--mcp-port <port>` | `3100`        | Tool server (MCP) port to configure                            |
| `--global`          | —             | Claude Code: write `~/.claude.json` instead of `./.mcp.json`   |
| `--dry-run`         | —             | Print config without writing                                   |
| `--force`           | —             | Overwrite existing config                                      |

Claude Code config goes to `.mcp.json` at the project root; Copilot (VS Code) config goes to `.vscode/mcp.json`.

## Configuration

Configuration is resolved in priority order:

1. CLI arguments
2. Environment variables (`PLUTO_MCP_PORT`, `PLUTO_PORT`, `PLUTO_SERVER_URL`, `JULIA_VERSION`)
3. `.plutomcp.json` in current directory
4. Defaults

Example `.plutomcp.json`:

```json
{
  "mcpPort": 3100,
  "plutoPort": 1234,
  "juliaVersion": "1.12.7",
  "serverUrl": "http://localhost:1234"
}
```

Unknown options, options that do not apply to the command, and invalid values are errors (exit code 2). Set `PLUTO_CLI_DEBUG=1` to see stack traces for unexpected failures. Colors follow `NO_COLOR` / `FORCE_COLOR`.

## Notebook tools

These tools are callable from the command line via `call`, and exposed to AI assistants over MCP:

| Tool                      | Description                                |
| ------------------------- | ------------------------------------------ |
| `learn_pluto_basics`      | Get a comprehensive Pluto.jl guide         |
| `start_pluto_server`      | Start the Pluto server                     |
| `stop_pluto_server`       | Stop the Pluto server                      |
| `connect_to_pluto_server` | Connect to an existing server              |
| `get_notebook_status`     | Check server status                        |
| `open_notebook`           | Open a notebook file                       |
| `move_notebook`           | Move a notebook to a new path              |
| `save_notebook`           | Save the running notebook to disk          |
| `export_notebook_html`    | Export a static HTML snapshot to disk      |
| `wait_for_notebook_idle`  | Block until no cell is running or queued   |
| `list_notebooks`          | List all open notebooks                    |
| `get_notebook_url`        | Get the Pluto web UI URL for a notebook    |
| `list_cells`              | List cells with IDs and execution status   |
| `create_cell`             | Create and execute a new cell              |
| `read_cell`               | Read cell code and output                  |
| `edit_cell`               | Update cell code                           |
| `execute_cell`            | Run an existing cell                       |
| `delete_cell`             | Remove a cell                              |
| `move_cells`              | Reorder cells                              |
| `fold_cell`               | Show or hide a cell's code in the Pluto UI |
| `execute_code`            | Execute code ephemerally (no cell created) |
| `get_docs`                | Get Julia symbol documentation             |
| `introspect_notebook`     | List all symbols defined in a notebook     |

## Related

- [Advanced Pluto Notebook for VSCode](https://marketplace.visualstudio.com/items?itemName=juliapluto-pankgeorg.advanced-vscode-extension) — VSCode extension with full notebook UI
- [Pluto.jl](https://plutojl.org/) — Reactive Julia notebooks
