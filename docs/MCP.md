# Pluto Notebook MCP Server

Complete guide for the Pluto Notebook MCP (Model Context Protocol) server.

## Table of Contents

- [Quick Start](#quick-start)
- [What is MCP?](#what-is-mcp)
- [Setup and Configuration](#setup-and-configuration)
- [Available Tools](#available-tools)
- [Usage Examples](#usage-examples)
- [Architecture](#architecture)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

Get started with the Pluto Notebook MCP server in 2 minutes!

### What is This?

The Pluto Notebook extension includes an HTTP-based MCP (Model Context Protocol) server that lets AI assistants like GitHub Copilot Chat and Claude Code interact with your Julia Pluto notebooks.

### Step 1: Activate the Extension

Open any `.jl` file in VS Code. The extension will:

- ✅ Automatically start the Pluto server
- ✅ Automatically start the MCP HTTP server on port 3100
- ✅ Show status in "Pluto Server" output channel

### Step 2: Configure Your AI Tool

- **VS Code chat (GitHub Copilot and other in-editor agents)**: nothing to do. The extension registers a "Pluto Notebook" server with VS Code's native MCP support, so it appears in `MCP: List Servers` and in the chat tools picker.
- **Claude Code**: run `Pluto: Create Claude Code MCP Config (.mcp.json)` to write the workspace `.mcp.json`.

### Step 3: Start the Tools

- **VS Code chat**: enable the "Pluto Notebook" tools in the chat tools picker. VS Code starts the MCP server on demand if it is not running.
- **Claude Code**: start (or restart) Claude Code in the workspace so it picks up `.mcp.json`

### Step 4: Test It!

Ask your AI assistant:

```
List all open Pluto notebooks
```

or

```
Execute this code in my notebook: println("Hello from MCP!")
```

---

## What is MCP?

The MCP server provides the following capabilities to AI assistants:

- 📋 **List notebooks** - See all open notebooks
- ▶️ **Execute code** - Run Julia code without modifying notebook
- 📝 **Create cells** - Add new cells with code
- ✏️ **Edit cells** - Update existing cell code
- 👀 **Read cells** - View cell code and output
- 🔍 **Query status** - Check server and notebook status

---

## Setup and Configuration

### Benefits

- **Shared State**: The extension and MCP clients share the same Pluto server connection and worker sessions
- **No Duplicate Processes**: Single Pluto server instance managed by the extension
- **HTTP-based**: More flexible than stdio, works with any HTTP client
- **Health Monitoring**: Built-in health check endpoint

### Configuration Settings

The MCP server can be configured with the following settings:

```json
{
  "pluto-notebook.port": 1234, // Pluto server port
  "pluto-notebook.mcpPort": 3100, // MCP HTTP server port
  "pluto-notebook.autoStartMcpServer": true // Auto-start MCP server (default: true)
}
```

### Auto-Start Behavior

By default, the MCP server starts automatically when the extension activates. To disable auto-start:

1. Open VS Code settings
2. Search for "Pluto Notebook"
3. Uncheck "Auto Start Mcp Server"

Or add to your `settings.json`:

```json
{
  "pluto-notebook.autoStartMcpServer": false
}
```

When auto-start is disabled, use `Pluto: Start MCP Server` command to start manually.

### Endpoints

- **MCP (Streamable HTTP)**: `http://localhost:3100/mcp` — what VS Code, Claude Code and the CLI use
- **Legacy SSE**: `GET http://localhost:3100/mcp` without a session id, with messages on `POST /messages`, for older MCP clients
- **Health Check**: `http://localhost:3100/health` (GET)

### Client Configuration

#### VS Code chat (GitHub Copilot and other in-editor agents)

The extension contributes an MCP server definition provider (`pluto-notebook.mcpServers`), the native way for extensions to expose MCP servers in VS Code 1.101 and newer. No config file is involved:

- `MCP: List Servers` shows "Pluto Notebook" once the extension has activated (open any `.pluto.jl` file).
- Enable the "Pluto Notebook" tools in the chat tools picker. If the MCP server is not running, VS Code starts it on demand.
- The definition always points at the port the server is actually listening on. When the configured port is busy (another VS Code window), the server moves to the next free port and VS Code is told about the new address.

Do not add a `pluto-notebook` entry to `.vscode/mcp.json` as well: it would register the same server twice, and a hand-written port goes stale as soon as the server falls back to another one.

#### Claude Code

Claude Code runs outside VS Code, so it needs `.mcp.json` in your workspace root:

```json
{
  "mcpServers": {
    "pluto-notebook": {
      "url": "http://localhost:3100/mcp",
      "type": "http"
    }
  }
}
```

**Quick Setup:**

1. Run command: `Pluto: Create Claude Code MCP Config (.mcp.json)`
2. File `.mcp.json` is created (or the `pluto-notebook` entry is merged into the existing one) in the workspace root and opened
3. Start or restart Claude Code in the workspace to load the config

The command writes the port the server is currently listening on, so run it from the VS Code window whose server you want Claude Code to talk to.

### Port Configuration

The server starts on the port from VS Code settings and falls back to the next free port when that one is taken:

```json
{
  "pluto-notebook.mcpPort": 3100 // Default
}
```

To change the port:

1. Update setting: `pluto-notebook.mcpPort`
2. Restart MCP server: `Pluto: Restart MCP Server`
3. VS Code chat picks up the new address automatically; recreate `.mcp.json` for Claude Code

---

## Available Tools

The tool server's own `tools/list` is the reference; this guide does not copy it. To see it from a terminal:

```bash
npx @plutojl/cli tools                 # every tool, one line each
npx @plutojl/cli tools read_cell_output # one tool's parameters, types and defaults
npx @plutojl/cli call learn_pluto_basics
```

The [`@plutojl/cli` README](../packages/advanced-pluto-mcp/README.md#notebook-tools) has a one-line table of all tools, checked against the tool set by the test suite.

Start with `learn_pluto_basics`: it covers the notebook file format, reactivity rules, environments and the recommended workflow. Server tools take no port; the Pluto server is the one configured in the extension settings (or by the CLI's `--pluto-port` / `--pluto-url`).

`npx @plutojl/cli call` checks arguments against the tool's schema before sending them, so a misspelled or unknown argument is an error rather than silently ignored.

---

## Usage Examples

Example prompts for an assistant connected over MCP:

```
- "Open the notebook at /path/to/analysis.jl and list its cells"
- "Run 2 + 2 in that notebook without adding a cell"
- "Create a cell that loads DataFrames, then show me its output"
```

The same steps from a terminal:

```bash
npx @plutojl/cli call open_notebook '{"path": "analysis.pluto.jl"}'
npx @plutojl/cli call list_cells '{"path": "analysis.pluto.jl"}'
npx @plutojl/cli call execute_code '{"path": "analysis.pluto.jl", "code": "2 + 2"}'
npx @plutojl/cli call create_cell '{"path": "analysis.pluto.jl"}' --code-file cell.jl
```

---

## Architecture

```
  VS Code chat       Claude Code        npx @plutojl/cli call / tools
  (native MCP)       (.mcp.json)        (Streamable HTTP client)
       │                  │                        │
       └──────────────────┼────────────────────────┘
                          ▼
┌───────────────────────────────────────────────────────────┐
│  Tool server (MCP over HTTP, port 3100)                   │
│  - POST   /mcp       Streamable HTTP requests             │
│  - GET    /mcp       with mcp-session-id: session stream  │
│  - DELETE /mcp       end a Streamable HTTP session        │
│  - GET    /mcp       without a session id: legacy SSE     │
│  - POST   /messages  legacy SSE messages                  │
│  - GET    /health    status, Pluto URL, session counts    │
└───────────────────────────┬───────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────┐
│  PlutoManager (shared with the notebook controller in     │
│  VS Code, or owned by `npx @plutojl/cli run`)             │
└───────────────────────────┬───────────────────────────────┘
                            ▼
                 Pluto server (Julia process)
```

---

## Commands

### Pluto Server Commands

| Command                 | Description                 |
| ----------------------- | --------------------------- |
| `Pluto: Start Server`   | Manually start Pluto server |
| `Pluto: Stop Server`    | Stop Pluto server           |
| `Pluto: Restart Server` | Restart Pluto server        |

### MCP Server Commands

| Command                     | Description                    |
| --------------------------- | ------------------------------ |
| `Pluto: Start MCP Server`   | Manually start MCP HTTP server |
| `Pluto: Stop MCP Server`    | Stop MCP HTTP server           |
| `Pluto: Restart MCP Server` | Restart MCP HTTP server        |

### Configuration Commands

| Command                                            | Description                                     |
| -------------------------------------------------- | ----------------------------------------------- |
| `Pluto: Create Claude Code MCP Config (.mcp.json)` | Write the workspace `.mcp.json` for Claude Code |
| `Pluto: Get MCP HTTP Server URL`                   | Show the endpoint URL and related actions       |

The `Pluto: Get MCP HTTP Server URL` command provides actions:

- **Copy URL** - Copy MCP endpoint URL to clipboard
- **Create Claude Code Config** - Create `.mcp.json`
- **Open Health Check** - Open health endpoint in a browser

VS Code chat needs no command: the server is registered through the native MCP provider.

---

## Troubleshooting

### MCP Server Not Starting

Check the "Pluto Server" output channel in VS Code:

```
View → Output → Select "Pluto Server"
```

**If auto-start is disabled:**

1. Check if auto-start is enabled: `pluto-notebook.autoStartMcpServer`
2. Try starting manually: `Pluto: Start MCP Server`
3. Check the "Pluto Server" output channel for errors

### Port Already in Use

Change the port in settings:

```json
{
  "pluto-notebook.mcpPort": 3200 // Use different port
}
```

Then:

1. Restart the MCP server: `Pluto: Restart MCP Server`
2. Recreate `.mcp.json` for Claude Code (VS Code chat follows the new port on its own)

### Claude Code Can't Connect

1. Verify extension is active (open a `.jl` file)
2. Check health endpoint: `http://localhost:3100/health`
3. Verify config file location:
   - **Claude Code config**: Workspace root
   - **Name**: `.mcp.json`
4. Restart Claude Code

**Checklist**:

1. ✅ `.mcp.json` exists in workspace root
2. ✅ File has correct format (see above)
3. ✅ Extension is active (open a `.jl` file)
4. ✅ MCP server is running
5. ✅ Restarted Claude Code after creating config

### VS Code Chat Can't See the Server

1. Verify VS Code is 1.101 or newer and MCP support is enabled (`chat.mcp.enabled`)
2. Open a `.pluto.jl` file so the extension activates and registers the provider
3. Run `MCP: List Servers` and check that "Pluto Notebook" is listed; check the "Pluto Controller" output channel for the registration line
4. Start the server from that list (or enable its tools in the chat tools picker) and check the health endpoint
5. Remove any stale `pluto-notebook` entry from `.vscode/mcp.json`; it would point at a fixed port

### Config File Not Created

**Symptom**: Command completes but no file appears

**Solution**:

1. Check workspace is open
2. Verify write permissions
3. Check output in "Pluto Server" channel

### Shared State Issues

The extension and MCP clients share the same PlutoManager. If you close a notebook in VS Code, it will also be closed for MCP clients.

### Health Check

Verify the MCP server is running:

```bash
curl http://localhost:3100/health
```

Expected response:

```json
{
  "status": "ok",
  "host": "vscode",
  "version": "0.10.0",
  "plutoServerRunning": true,
  "plutoUrl": "http://localhost:1234",
  "activeSessions": 1,
  "transports": { "sse": 0, "streamableHttp": 1 }
}
```

`npx @plutojl/cli status` reads the same endpoint and prints it readably.

### Verification Commands

**Check Config File Exists**

Claude Code:

```bash
cat <workspace>/.mcp.json
```

VS Code chat: run `MCP: List Servers` instead; there is no file to check.

**Check MCP Server Running**

```bash
curl http://localhost:3100/health
```

---

## Error Handling

A tool that fails returns a normal MCP result with `isError: true` and a text message that says what to do next (for example, to start Pluto with `start_pluto_server` or to look up cell IDs with `list_cells`). `npx @plutojl/cli call` prints that message and exits with status 1.

---

## Best Practices

💡 **Pro Tips:**

- Use `execute_code` for quick queries without modifying notebooks
- The `list_notebooks` tool shows all open notebooks with their paths
- MCP server shares state with the VS Code extension
- Changes via MCP are reflected immediately in VS Code
- Close notebooks in VS Code to free up MCP resources

🎯 **Best Practices:**

- Keep one notebook open at a time for focused work
- Use ephemeral execution for exploration
- Create persistent cells for important code
- Check health endpoint before debugging
- Use the command for `.mcp.json` creation over manual editing
- Add `.mcp.json` to `.gitignore` if needed
- Recreate `.mcp.json` after changing `mcpPort`
- Test connection using health check
- Document the MCP port in project README for team sharing

---

## Example Workflow

1. Open Pluto notebook project in VS Code
2. Extension activates, MCP server starts on port 3100
3. VS Code chat: enable the "Pluto Notebook" tools in the tools picker
4. Claude Code: run `Pluto: Create Claude Code MCP Config (.mcp.json)` and restart Claude Code
5. Ask the assistant: "List all open Pluto notebooks"
6. It connects via MCP and responds!

---

## Summary

- **VS Code chat**: Discovers the server through the native MCP server definition provider; no config file
- **Claude Code**: Uses `.mcp.json` in workspace root, written by a command that preserves existing entries
- **Port Configurable**: Via `pluto-notebook.mcpPort` setting
- **Shared State**: Single PlutoManager instance for extension and MCP
- **HTTP-based**: Streamable HTTP, with a legacy SSE fallback on the same port

---

## Support

If you encounter issues:

1. Check the "Pluto Server" output channel
2. Verify health endpoint responds
3. Review configuration files
4. Restart the extension/IDE
5. File an issue with logs

---

**Ready to go!** 🚀

Open a `.jl` file and enable the Pluto Notebook tools in VS Code chat, or run `Pluto: Create Claude Code MCP Config (.mcp.json)` for Claude Code.
