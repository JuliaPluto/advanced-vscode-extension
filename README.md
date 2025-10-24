# Pluto Notebook for VS Code

A [VS Code extension](https://marketplace.visualstudio.com/items?itemName=juliapluto-pankgeorg.advanced-vscode-extension) for working with Julia Pluto notebooks, featuring an integrated MCP (Model Context Protocol) server for AI assistant interaction.
Note that this is an advanced tool meant for power users who mostly want to stay in VSCode but still leverage Pluto's execution infrastructure without the UI.

This is a collaboration between [@dr14-make](https://github.com/dr14-make) and [@pankgeorg](https://github.com/pankgeorg), is at "experiment" quality, under heavy development and will change drastically in the future and may be abandonded without notice.

While tightly coupled with [Pluto.jl](https://github.com/fonsp/Pluto.jl), this project follows a highly experimental, different path,
so please don't raise issues about this in the official Pluto.jl channels or repositories. Instead, reach out directly to the contributors above in your favourite platform!

## Features

- **Notebook Interface**: Edit and run Pluto notebooks directly in VS Code
- **Integrated Pluto Server**: Automatically manages Pluto server lifecycle
- **Interactive Terminal**: Execute Julia code in an integrated terminal with rich output rendering
- **MCP Server**: HTTP-based MCP server for AI assistants like Claude Desktop and GitHub Copilot
- **Shared State**: Extension and MCP clients share the same Pluto server connection
- **Real-time Execution**: Execute Julia code and see results immediately
- **Cell Management**: Create, edit, and execute notebook cells
- **Ephemeral Execution**: Run code without modifying notebook structure
- **Rich Output**: Support for HTML, images, plots, and interactive content

## Requirements

- **juliaup**: The Julia version manager must be installed and available in your PATH
  - Install from: https://github.com/JuliaLang/juliaup#installation
  - The extension will automatically install Julia 1.11.7 and Pluto.jl when needed

## Quick Start

1. Open any `.pluto.jl` file in VS Code
2. The extension automatically starts the Pluto server and MCP server
3. Start working with your notebooks!

## Extension Settings

This extension contributes the following settings:

- `pluto-notebook.port`: Port number for the Pluto server (default: 1234)
- `pluto-notebook.mcpPort`: Port number for the MCP HTTP server (default: 3100)
- `pluto-notebook.autoStartMcpServer`: Automatically start the MCP HTTP server when the extension activates (default: true)

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

- `Pluto: Create MCP Config (Claude or Copilot)` - Create config file with interactive picker
- `Pluto: Get MCP HTTP Server URL` - Get URL and config options

### Notebook Commands

- `Pluto: Open Notebook in Browser` - Open the current notebook in browser
- `Pluto: Create Terminal` - Create an interactive Pluto terminal

## Using with AI Assistants

The extension includes an MCP server that allows AI assistants to interact with your Pluto notebooks.

### Claude Desktop

Run the command `Pluto: Create MCP Config (Claude or Copilot)`, select "Claude Desktop", and restart Claude Desktop.

### GitHub Copilot

Run the command `Pluto: Create MCP Config (Claude or Copilot)`, select "GitHub Copilot", and reload VS Code.

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

## Support

For issues, questions, or contributions, please visit the project repository on github.

**Enjoy!**
