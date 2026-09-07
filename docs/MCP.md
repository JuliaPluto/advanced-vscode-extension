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

- **SSE Stream**: `http://localhost:3100/mcp` (GET)
- **Messages**: `http://localhost:3100/messages` (POST)
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

The MCP server exposes the following tools:

1. **learn_pluto_basics**: Get comprehensive guide on Pluto.jl notebook structure and best practices
2. **start_pluto_server**: Start the Pluto server
3. **connect_to_pluto_server**: Connect to an existing Pluto server
4. **stop_pluto_server**: Stop the Pluto server
5. **open_notebook**: Open a Pluto notebook and create a worker session
6. **list_notebooks**: Get a list of all open notebooks with their paths and IDs
7. **execute_cell**: Execute an existing cell by ID
8. **create_cell**: Create and execute a new cell
9. **edit_cell**: Update the code of an existing cell
10. **read_cell**: Read the code and output of a cell
11. **execute_code**: Execute Julia code without creating a persistent cell (ephemeral)
12. **get_notebook_status**: Get server and notebook status

### Server Management

#### start_pluto_server

Start the Pluto server on the configured port.

```json
{
  "name": "start_pluto_server",
  "arguments": {
    "port": 1234
  }
}
```

#### connect_to_pluto_server

Connect to an already running Pluto server (useful if Julia is running externally).

```json
{
  "name": "connect_to_pluto_server",
  "arguments": {
    "port": 1234
  }
}
```

#### stop_pluto_server

Stop the running Pluto server.

```json
{
  "name": "stop_pluto_server",
  "arguments": {}
}
```

#### get_notebook_status

Check if the Pluto server is running.

```json
{
  "name": "get_notebook_status",
  "arguments": {}
}
```

Response:

```json
{
  "server_running": true,
  "message": "Pluto server is running"
}
```

### Learning Resources

#### learn_pluto_basics

Get comprehensive guide on Pluto.jl notebook structure, reactivity, PlutoUI components, and best practices.

```json
{
  "name": "learn_pluto_basics",
  "arguments": {}
}
```

Response: Returns complete markdown documentation covering:

- Notebook file format and cell structure
- Reactive execution model and rules
- Complete PlutoUI component reference (Slider, TextField, NumberField, CheckBox, Select, Button, etc.)
- Combining markdown with interactive widgets
- Best practices and common patterns

**Usage**: AI assistants should call this tool first to understand how to properly create and modify Pluto notebooks.

### Notebook Management

#### open_notebook

Open a Pluto notebook and create a worker session.

```json
{
  "name": "open_notebook",
  "arguments": {
    "path": "/path/to/notebook.jl"
  }
}
```

Response:

```json
{
  "message": "Notebook opened: /path/to/notebook.jl\nNotebook ID: abc-123-def"
}
```

#### list_notebooks

Get a list of all currently open notebooks.

```json
{
  "name": "list_notebooks",
  "arguments": {}
}
```

Response:

```json
{
  "count": 2,
  "notebooks": [
    {
      "path": "/path/to/notebook1.jl",
      "notebookId": "abc-123-def"
    },
    {
      "path": "/path/to/notebook2.jl",
      "notebookId": "xyz-456-ghi"
    }
  ]
}
```

### Cell Operations

#### create_cell

Create a new cell and execute it.

```json
{
  "name": "create_cell",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "code": "x = 1 + 1",
    "index": 0
  }
}
```

Response:

```json
{
  "cell_id": "abc-123",
  "output": {
    "body": "2",
    "mime": "text/plain"
  },
  "runtime": 0.05,
  "errored": false,
  "message": "Cell created and executed successfully"
}
```

#### read_cell

Read the code and output of an existing cell.

```json
{
  "name": "read_cell",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "cell_id": "abc-123"
  }
}
```

Response:

```json
{
  "cell_id": "abc-123",
  "code": "x = 1 + 1",
  "output": {
    "body": "2",
    "mime": "text/plain"
  },
  "runtime": 0.05,
  "errored": false,
  "running": false,
  "queued": false
}
```

#### edit_cell

Update the code of an existing cell.

```json
{
  "name": "edit_cell",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "cell_id": "abc-123",
    "code": "x = 2 + 2",
    "run": true
  }
}
```

Response:

```json
{
  "cell_id": "abc-123",
  "output": {
    "body": "4",
    "mime": "text/plain"
  },
  "runtime": 0.03,
  "errored": false,
  "message": "Cell updated and executed successfully"
}
```

#### execute_cell

Execute an existing cell (runs current code in the cell).

```json
{
  "name": "execute_cell",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "cell_id": "abc-123"
  }
}
```

Response:

```json
{
  "cell_id": "abc-123",
  "output": {
    "body": "4",
    "mime": "text/plain"
  },
  "runtime": 0.03,
  "errored": false
}
```

### Code Execution

#### execute_code

Execute Julia code without creating a persistent cell (ephemeral execution).

This is useful for:

- Quick queries or evaluations
- Testing code snippets
- Inspecting variable values
- Running diagnostic commands

The code has access to all variables defined in the notebook, but doesn't modify the notebook structure.

```json
{
  "name": "execute_code",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "code": "println(\"x = $x\")"
  }
}
```

Response:

```json
{
  "output": {
    "body": "x = 4",
    "mime": "text/plain"
  },
  "runtime": 0.01,
  "errored": false,
  "message": "Code executed successfully (no cell created)"
}
```

**Important**: The cell is created temporarily and deleted immediately after execution. It will not appear in the notebook file.

---

## Usage Examples

### Example Prompts

Try asking Claude or Copilot:

**Basic Operations:**

```
- "List all open notebooks"
- "Open the notebook at /path/to/analysis.jl"
- "What's the status of the Pluto server?"
```

**Code Execution:**

```
- "Execute: 2 + 2"
- "Run this code without saving: println(x)"
- "What's the value of variable x?"
```

**Notebook Manipulation:**

```
- "Create a cell that imports DataFrames"
- "Edit cell abc-123 to use Plots instead of StatsPlots"
- "Show me the output of cell xyz-789"
```

### Workflow Examples

#### Workflow 1: Quick Data Analysis

1. **Start server and open notebook**:

```json
{"name": "start_pluto_server", "arguments": {}}
{"name": "open_notebook", "arguments": {"path": "/path/to/analysis.jl"}}
```

2. **Check what notebooks are open**:

```json
{ "name": "list_notebooks", "arguments": {} }
```

3. **Execute quick queries without modifying notebook**:

```json
{
  "name": "execute_code",
  "arguments": {
    "path": "/path/to/analysis.jl",
    "code": "summary(dataframe)"
  }
}
```

#### Workflow 2: Interactive Development

1. **Create cells incrementally**:

```json
{
  "name": "create_cell",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "code": "using DataFrames",
    "index": 0
  }
}
```

2. **Edit and refine**:

```json
{
  "name": "edit_cell",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "cell_id": "abc-123",
    "code": "using DataFrames, Plots"
  }
}
```

3. **Test with ephemeral execution**:

```json
{
  "name": "execute_code",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "code": "plot(1:10, rand(10))"
  }
}
```

#### Workflow 3: Notebook Inspection

1. **List all open notebooks**:

```json
{ "name": "list_notebooks", "arguments": {} }
```

2. **Read specific cells**:

```json
{
  "name": "read_cell",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "cell_id": "abc-123"
  }
}
```

3. **Query variable state without creating cells**:

```json
{
  "name": "execute_code",
  "arguments": {
    "path": "/path/to/notebook.jl",
    "code": "varinfo()"
  }
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                VS Code Extension                     │
│  ┌────────────────┐        ┌──────────────────┐    │
│  │   Controller   │───────▶│  PlutoManager    │◀───┼───┐
│  │   Serializer   │        │  (Shared)        │    │   │
│  └────────────────┘        └──────────────────┘    │   │
│                                      │               │   │
│                                      ▼               │   │
│                            ┌──────────────────┐     │   │
│                            │  Pluto Server    │     │   │
│                            │  (Julia Process) │     │   │
│                            └──────────────────┘     │   │
└─────────────────────────────────────────────────────┘   │
                                                           │
┌─────────────────────────────────────────────────────┐   │
│              MCP HTTP Server                        │   │
│  ┌────────────────────────────────────────────┐    │   │
│  │  HTTP/SSE Endpoints                        │    │   │
│  │  - GET  /mcp (SSE stream)                  │    │   │
│  │  - POST /messages (JSON-RPC)               │    │   │
│  │  - GET  /health (health check)             │    │   │
│  └────────────────────────────────────────────┘    │   │
│                      │                              │   │
└──────────────────────┼──────────────────────────────┘   │
                       │                                  │
                       └──────────────────────────────────┘
                                (Shared PlutoManager)

         ▲
         │
    ┌────┴─────┐
    │  Claude  │
    │ Desktop  │
    │   (MCP   │
    │  Client) │
    └──────────┘
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
  "plutoServerRunning": true,
  "activeSessions": 0
}
```

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

All tools return error information when something goes wrong:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Pluto server is not running"
    }
  ]
}
```

Common errors:

- `"Pluto server is not running"` - Start the server first
- `"Notebook {path} is not open"` - Open the notebook first
- `"Cell {id} not found"` - Invalid cell ID

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
- **HTTP-based**: Flexible SSE transport for real-time communication

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

Open a `.jl` file, run `Pluto: Create MCP Config`, and start chatting with your AI assistant about your Pluto notebooks!
