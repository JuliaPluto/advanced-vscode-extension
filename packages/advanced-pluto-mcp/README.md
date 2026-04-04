# advanced-pluto-mcp

Standalone MCP (Model Context Protocol) server for [Pluto.jl](https://plutojl.org/) notebooks. Enables AI assistants like Claude and GitHub Copilot to interact with Julia Pluto notebooks.

## Quick Start

```bash
# Start the MCP server (also starts a Pluto server)
npx advanced-pluto-mcp run

# Install MCP config for Claude Code
npx advanced-pluto-mcp install
```

## Prerequisites

- **Node.js** >= 18
- **Julia** — install from [julialang.org](https://julialang.org/downloads/) or via [juliaup](https://github.com/JuliaLang/juliaup)
- **Pluto.jl** — installed automatically on first run

## Commands

### `run`

Start the MCP server (and a Pluto server if needed).

```bash
npx advanced-pluto-mcp run [options]
```

| Option                  | Default  | Description                                          |
| ----------------------- | -------- | ---------------------------------------------------- |
| `--mcp-port <port>`     | `3100`   | MCP server port                                      |
| `--pluto-port <port>`   | `1234`   | Pluto server port                                    |
| `--pluto-url <url>`     | —        | Connect to existing Pluto server (skip starting one) |
| `--julia-version <ver>` | `1.11.7` | Julia version via juliaup                            |

### `install`

Add MCP configuration files for AI assistants.

```bash
npx advanced-pluto-mcp install [options]
```

| Option              | Default       | Description                                       |
| ------------------- | ------------- | ------------------------------------------------- |
| `--target <target>` | `claude-code` | Config target: `claude-code`, `copilot`, or `all` |
| `--mcp-port <port>` | `3100`        | MCP server port to configure                      |
| `--global`          | —             | Write to `~/.claude/` instead of `./.claude/`     |
| `--dry-run`         | —             | Print config without writing                      |
| `--force`           | —             | Overwrite existing config                         |

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

## MCP Tools

The server exposes these tools to AI assistants:

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
