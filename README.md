# Pluto Notebook for VS Code

A [VS Code extension](https://marketplace.visualstudio.com/items?itemName=juliapluto-pankgeorg.advanced-vscode-extension) for working with Julia Pluto notebooks, featuring an integrated MCP (Model Context Protocol) server for AI assistant interaction.
Note that this is an advanced tool meant for power users who mostly want to stay in VSCode but still leverage Pluto's execution infrastructure without the UI.

This is a collaboration between [@dr14-make](https://github.com/dr14-make) and [@pankgeorg](https://github.com/pankgeorg). It was developed with the generous support of JuliaHub, as an experiment during the development of [Dyad](https://juliahub.com/products/dyad).

While tightly coupled with [Pluto.jl](https://github.com/fonsp/Pluto.jl), this project follows a highly experimental, different path,
so please don't raise issues about this in the official Pluto.jl channels or repositories. Instead, reach out directly to the contributors above in your favourite platform!

## Features

- **Notebook Interface**: Edit and run Pluto notebooks directly in VS Code
- **Integrated Pluto Server**: Automatically manages Pluto server lifecycle
- **Interactive Terminal**: Execute Julia code in an integrated terminal with rich output rendering
- **MCP Server**: HTTP-based MCP server for AI assistants; registered with VS Code's native MCP support (Copilot Chat) and usable from Claude Code
- **Shared State**: Extension and MCP clients share the same Pluto server connection
- **Real-time Execution**: Execute Julia code and see results immediately
- **Cell Management**: Create, edit, and execute notebook cells
- **Ephemeral Execution**: Run code without modifying notebook structure
- **Rich Output**: Support for HTML, images, plots, and interactive content

## Requirements

- **juliaup**: The Julia version manager must be installed and available in your PATH
  - Install from: https://github.com/JuliaLang/juliaup#installation
  - The extension uses the Julia channel configured in the Julia extension and installs Pluto.jl into it when needed

## Quick Start

1. Open any `.pluto.jl` file in VS Code
2. The extension automatically starts the Pluto server and MCP server
3. Start working with your notebooks!

## Extension Settings

This extension contributes the following settings:

- `pluto-notebook.port`: Port number for the Pluto server (default: 1234)
- `pluto-notebook.mcpPort`: Port number for the MCP HTTP server (default: 3100)
- `pluto-notebook.autoStartMcpServer`: Automatically start the MCP HTTP server when the extension activates (default: true)
- `pluto-notebook.notebookBrowser`: Where `Pluto: Open Notebook in Browser` opens the Pluto editor: `embedded` (VS Code's Simple Browser, beside the editor; default) or `external` (system browser)
- `pluto-notebook.autoReloadFromFile`: Start the Pluto server with `auto_reload_from_file=true`, so edits made to a notebook file outside the notebook editor are applied to the running notebook (default: `false`; takes effect on the next server start)
- `pluto-notebook.foldHiddenCells`: Show cells that Pluto marks as hidden (`╟─` in the file) with their code collapsed, as Pluto does (default: `true`). Folds made in Pluto or by `fold_cell` collapse the cell in the editor; collapsing a cell by hand in VS Code does not change the file.
- `pluto-notebook.juliaVersion`: Fallback Julia version for juliaup when the Julia extension is unavailable. Normally the active Julia channel (e.g. `julia.executablePath` in workspace settings, or the juliaup default) comes from the Julia extension.

## Available Commands

### Pluto Server Commands

- `Pluto: Start Server` - Manually start Pluto server
- `Pluto: Stop Server` - Stop Pluto server
- `Pluto: Restart Server` - Restart Pluto server

### MCP Server Commands

- `Pluto: Start MCP Server` - Manually start MCP HTTP server
- `Pluto: Stop MCP Server` - Stop MCP HTTP server
- `Pluto: Restart MCP Server` - Restart MCP HTTP server

### Configuration Commands

- `Pluto: Create Claude Code MCP Config (.mcp.json)` - Write the workspace `.mcp.json` for Claude Code
- `Pluto: Get MCP HTTP Server URL` - Show the endpoint, copy it, or open the health check

### Notebook Commands

- `Pluto: Open Notebook in Browser` - Open the current notebook in Pluto's own editor, inside VS Code's Simple Browser (see `pluto-notebook.notebookBrowser`)
- `Pluto: Create Terminal` - Create an interactive Pluto terminal

## Using with AI Assistants

The extension includes an MCP server that allows AI assistants to interact with your Pluto notebooks.

### VS Code chat (GitHub Copilot and other in-editor agents)

Nothing to configure. The extension registers a "Pluto Notebook" server with VS Code's built-in MCP support (VS Code 1.101 or newer), so it shows up in `MCP: List Servers` and in the chat tools picker as soon as a Pluto notebook has been opened. If the MCP server is not running yet, VS Code starts it when the tools are first used.

### Claude Code

Run the command `Pluto: Create Claude Code MCP Config (.mcp.json)` and the workspace `.mcp.json` is written for you.

For detailed setup instructions, see the [MCP documentation](docs/MCP.md).

## Documentation

- **[MCP Server Guide](docs/MCP.md)** - Complete guide for MCP server setup and usage
- **[Terminal Guide](docs/TERMINAL.md)** - Interactive terminal for executing Julia code
- **[Pluto Server Task Guide](docs/PLUTO-SERVER-TASK.md)** - VSCode task integration for Pluto server
- **[Development Guide](CLAUDE.md)** - Instructions for developing and contributing to the extension
- **[Contributing Guide](docs/CONTRIBUTING.md)** - How to contribute to the project
- **[Semantic Release Guide](docs/SEMANTIC_RELEASE.md)** - Automated release workflow
- **[Changelog](CHANGELOG.md)** - Version history and release notes

## Architecture

The extension uses the `@plutojl/rainbow` package to communicate with the Pluto server. Both the VS Code extension and the MCP server share the same PlutoManager instance, ensuring consistency and avoiding duplicate processes.

```
VS Code Extension ──┐
                    ├──> Shared PlutoManager ──> Pluto Server (Julia)
MCP HTTP Server  ───┘
```

## Known Issues

- The extension is in active development
- Some advanced Pluto features may not be fully supported yet

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

## Dev TODO

- **Structural sync from external clients is new**: cells added, deleted, or reordered via the MCP tools (or Pluto's browser UI) now sync into the VSCode notebook view (`_handleCellReorder`). If you see cells duplicate or vanish when mixing VSCode edits with external edits, please file an issue with the Pluto Controller output-channel log.
- **PlutoUI bonds are half-wired**: moving a slider in the VSCode renderer reaches Pluto (`set_bond` → controller → `worker.setBond`) and recomputation streams back, but bond _state_ distribution is stubbed (`get_notebook` returns an empty notebook in `renderer/renderer.tsx`), so widgets don't restore positions and JS-interop widgets (`request_js_link_response`) don't work. Needs controller→renderer state plumbing plus manual UI verification.
- Upstream `@plutojl/rainbow` issues we work around: see `docs/UPSTREAM_RAINBOW_NOTES.md`.

## Support

For issues, questions, or contributions, please visit the project repository on github.

**Enjoy!**
