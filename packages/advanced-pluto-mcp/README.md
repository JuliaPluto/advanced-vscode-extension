# @plutojl/cli

Command-line tool for [Pluto.jl](https://plutojl.org/) notebooks. Start a Pluto server and drive notebooks straight from your terminal — open notebooks, create and execute cells, read outputs. The tool server it starts also speaks MCP (Model Context Protocol), so AI assistants like Claude and GitHub Copilot can use the same tools.

## Quick Start

```bash
# Start Pluto and the tool server
npx @plutojl/cli run

# In another terminal: drive notebooks from the command line
npx @plutojl/cli tools
npx @plutojl/cli call open_notebook '{"path": "notebook.pluto.jl"}'
npx @plutojl/cli call execute_code '{"code": "1 + 1"}'

# Optional: install MCP config so AI assistants can connect too
npx @plutojl/cli install
```

## Prerequisites

- **Node.js** >= 18
- **Julia** — install from [julialang.org](https://julialang.org/downloads/) or via [juliaup](https://github.com/JuliaLang/juliaup)
- **Pluto.jl** — installed automatically on first run

## Commands

### `run`

Start Pluto and the tool server.

```bash
npx @plutojl/cli run [options]
```

| Option                  | Default  | Description                                          |
| ----------------------- | -------- | ---------------------------------------------------- |
| `--mcp-port <port>`     | `3100`   | Tool server (MCP) port                               |
| `--pluto-port <port>`   | `1234`   | Pluto server port                                    |
| `--pluto-url <url>`     | —        | Connect to existing Pluto server (skip starting one) |
| `--julia-version <ver>` | `1.11.7` | Julia version via juliaup                            |
| `--no-pluto`            | —        | Start the tool server only, without starting Pluto   |

### `tools`

List the notebook tools available on a running server.

```bash
npx @plutojl/cli tools [--mcp-port <port>]
```

### `call`

Call a notebook tool from the command line.

```bash
npx @plutojl/cli call <tool_name> [json_args] [options]

# Examples
npx @plutojl/cli call get_notebook_status
npx @plutojl/cli call open_notebook '{"path": "/tmp/nb.pluto.jl"}'
npx @plutojl/cli call execute_code '{"code": "sqrt(2)"}'
```

| Option              | Default | Description             |
| ------------------- | ------- | ----------------------- |
| `--mcp-port <port>` | `3100`  | Tool server (MCP) port  |
| `--raw`             | —       | Output raw JSON response|

### `install`

Add MCP configuration files so AI assistants can connect to the tool server.

```bash
npx @plutojl/cli install [options]
```

| Option              | Default       | Description                                          |
| ------------------- | ------------- | ---------------------------------------------------- |
| `--target <target>` | `claude-code` | Config target: `claude-code`, `copilot`, or `all`    |
| `--mcp-port <port>` | `3100`        | Tool server (MCP) port to configure                  |
| `--global`          | —             | Write to `~/.claude.json` instead of `./.mcp.json`   |
| `--dry-run`         | —             | Print config without writing                         |
| `--force`           | —             | Overwrite existing config                            |

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
  "juliaVersion": "1.11.7"
}
```

## Notebook tools

These tools are callable from the command line via `call`, and exposed to AI assistants over MCP:

| Tool                      | Description                        |
| ------------------------- | ---------------------------------- |
| `learn_pluto_basics`      | Get a comprehensive Pluto.jl guide |
| `start_pluto_server`      | Start the Pluto server             |
| `stop_pluto_server`       | Stop the Pluto server              |
| `connect_to_pluto_server` | Connect to an existing server      |
| `get_notebook_status`     | Check server status                |
| `open_notebook`           | Open a notebook file               |
| `list_notebooks`          | List all open notebooks            |
| `create_cell`             | Create and execute a new cell      |
| `read_cell`               | Read cell code and output          |
| `edit_cell`               | Update cell code                   |
| `execute_cell`            | Run an existing cell               |
| `execute_code`            | Execute code ephemerally           |
| `get_docs`                | Get Julia symbol documentation     |
| `introspect_notebook`     | List all symbols in a notebook     |

## Related

- [Advanced Pluto Notebook for VSCode](https://marketplace.visualstudio.com/items?itemName=juliapluto-pankgeorg.advanced-vscode-extension) — VSCode extension with full notebook UI
- [Pluto.jl](https://plutojl.org/) — Reactive Julia notebooks
