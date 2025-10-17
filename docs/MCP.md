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

The Pluto Notebook extension includes an HTTP-based MCP (Model Context Protocol) server that lets AI assistants like Claude Desktop and GitHub Copilot interact with your Julia Pluto notebooks.

### Step 1: Activate the Extension

Open any `.jl` file in VS Code. The extension will:

- ✅ Automatically start the Pluto server
- ✅ Automatically start the MCP HTTP server on port 3100
- ✅ Show status in "Pluto Server" output channel

### Step 2: Configure Your AI Tool

Run this command in VS Code:

```
Pluto: Create MCP Config (Claude or Copilot)
```

Choose your tool:

- **Claude Desktop** → Creates `.mcp.json`
- **GitHub Copilot** → Creates `mcp.json`

### Step 3: Restart Your AI Tool

- **Claude Desktop**: Restart the app
- **GitHub Copilot**: Reload VS Code window (`Ctrl+Shift+P` → "Reload Window")

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

#### Claude Desktop

Create `.mcp.json` in your workspace root:

```json
{
  "mcpServers": {
    "pluto-notebook": {
      "url": "http://localhost:3100/mcp",
      "type": "sse"
    }
  }
}
```

**Quick Setup:**

1. Run command: `Pluto: Create MCP Config (Claude or Copilot)`
2. Select "Claude Desktop"
3. File `.mcp.json` is created in workspace root
4. Restart Claude Desktop to load the config

#### GitHub Copilot

Create `mcp.json` in your workspace root:

```json
{
  "servers": {
    "pluto-notebook": {
      "url": "http://localhost:3100/mcp",
      "type": "http"
    }
  },
  "inputs": []
}
```

**Quick Setup:**

1. Run command: `Pluto: Create MCP Config (Claude or Copilot)`
2. Select "GitHub Copilot"
3. File `mcp.json` is created/updated
4. Reload VS Code window (`Ctrl+Shift+P` → "Reload Window")

#### Configuration Differences

| Feature      | Claude Desktop | GitHub Copilot |
| ------------ | -------------- | -------------- |
| **File**     | `.mcp.json`    | `mcp.json`     |
| **Location** | Workspace root | Workspace root |
| **Type**     | `sse`          | `http`         |
| **Restart**  | Restart app    | Reload window  |
| **Purpose**  | MCP-specific   | MCP-specific   |

### Port Configuration

Both configs use the port from VS Code settings:

```json
{
  "pluto-notebook.mcpPort": 3100 // Default
}
```

To change the port:

1. Update setting: `pluto-notebook.mcpPort`
2. Recreate config files
3. Restart MCP server: `Pluto: Restart MCP Server`

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

| Command                                        | Description                                |
| ---------------------------------------------- | ------------------------------------------ |
| `Pluto: Create MCP Config (Claude or Copilot)` | Create config file with interactive picker |
| `Pluto: Get MCP HTTP Server URL`               | Get URL and config options                 |

The `Pluto: Get MCP HTTP Server URL` command provides actions:

- **Copy URL** - Copy MCP endpoint URL to clipboard
- **Create Claude Config** - Create `.mcp.json`
- **Create Copilot Config** - Create `mcp.json`
- **Open Health Check** - Open health endpoint in browser

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
2. Recreate your config files

### Claude Desktop Can't Connect

1. Verify extension is active (open a `.jl` file)
2. Check health endpoint: `http://localhost:3100/health`
3. Verify config file location:
   - **Claude Desktop config**: Workspace root
   - **Name**: `.mcp.json`
4. Restart Claude Desktop

**Checklist**:

1. ✅ `.mcp.json` exists in workspace root
2. ✅ File has correct format (see above)
3. ✅ Extension is active (open a `.jl` file)
4. ✅ MCP server is running
5. ✅ Restarted Claude Desktop after creating config

### GitHub Copilot Can't Connect

1. Verify config in `mcp.json` (workspace root)
2. Reload VS Code window
3. Check MCP support is enabled in Copilot settings

**Checklist**:

1. ✅ `mcp.json` exists in workspace root
2. ✅ File has correct format (see above)
3. ✅ Reloaded VS Code window
4. ✅ GitHub Copilot MCP support is enabled
5. ✅ Extension is active

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

Claude:

```bash
cat <workspace>/.mcp.json
```

Copilot:

```bash
cat <workspace>/mcp.json
```

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
- Use the command for config creation over manual editing
- Add `.mcp.json` to `.gitignore` if needed
- Keep `mcpPort` setting consistent with config files
- Test connection using health check
- Document the MCP port in project README for team sharing

---

## Example Workflow

1. Open Pluto notebook project in VS Code
2. Extension activates, MCP server starts on port 3100
3. Run: `Pluto: Create MCP Config (Claude or Copilot)`
4. Choose "Claude Desktop"
5. `.mcp.json` created and opened
6. Restart Claude Desktop
7. Ask Claude: "List all open Pluto notebooks"
8. Claude connects via MCP and responds!

---

## Summary

- **Claude Desktop**: Uses `.mcp.json` in workspace root
- **GitHub Copilot**: Uses `mcp.json` in workspace root
- **Interactive**: Use command for easy setup
- **Smart Merging**: Preserves existing configurations
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
