# Pluto Terminal

An interactive terminal for executing Julia code in Pluto notebooks with rich output rendering.

## Features

- **Ephemeral Execution**: Execute Julia code without creating persistent cells
- **Rich Output Rendering**: HTML, images, plots, and interactive content displayed in webviews
- **Command History**: Navigate through previous commands using arrow keys
- **Notebook Binding**: Connect to open notebooks or create new ones
- **Special Commands**: Built-in commands for terminal management
- **Example Commands**: Pre-built examples for testing functionality

## Getting Started

### Opening a Terminal

**Method 1: Command Palette**

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Pluto: Create Terminal"
3. Press Enter

**Method 2: Terminal Dropdown**

1. Click the "+" button in the terminal panel
2. Select "Pluto Terminal" from the dropdown

### First Use

When you open the terminal, it will automatically:

1. Try to connect to an open notebook
2. If no notebooks are open, prompt you to create or open one
3. If multiple notebooks are open, ask which one to connect to

## Usage

### Executing Code

Simply type Julia code and press Enter:

```julia
pluto> 2 + 2
4

pluto> using Plots; plot(1:10, rand(10))
[Rich Output: image/png]
Opening in webview...
✓ Output displayed in webview
```

### Command History

- **Arrow Up** (`↑`): Navigate to previous command
- **Arrow Down** (`↓`): Navigate to next command (or return to current input)

The terminal maintains a history of all executed commands in the current session. When you press Arrow Up, it will:

1. Save your current input (if any)
2. Show the most recent command
3. Continue showing older commands with each press
4. Pressing Arrow Down moves forward through history
5. Pressing Arrow Down at the end restores your original input

**Example:**

```
pluto> 1 + 1         # Execute
pluto> 2 + 2         # Execute
pluto> 3 + 3         # Execute
pluto> start typing... # Press ↑
pluto> 3 + 3         # Shows last command, press ↑ again
pluto> 2 + 2         # Shows previous command, press ↓
pluto> 3 + 3         # Back to most recent, press ↓ again
pluto> start typing... # Back to your input
```

**Features:**

- History persists during the terminal session
- Duplicate consecutive commands are not stored
- Current partial input is preserved when navigating history
- Pressing Enter executes the current command (whether from history or new)

### Special Commands

All special commands start with a dot (`.`):

#### `.help`

Show all available commands and tips.

```
pluto> .help
```

#### `.connect`

Connect to a notebook. Shows a list of open notebooks to choose from, or prompts to create/open one.

```
pluto> .connect
```

#### `.disconnect`

Disconnect from the current notebook. The notebook remains open, but the terminal won't execute code until reconnected.

```
pluto> .disconnect
```

#### `.notebooks`

List all currently open notebooks. The connected notebook is marked with a ✓.

```
pluto> .notebooks
Open Notebooks:
  - test.pluto.jl ✓
  - example.pluto.jl
```

#### `.status`

Show terminal and server status information.

```
pluto> .status
Terminal Status:
  Server: Running
  Server Connected: Yes
  Server URL: http://localhost:1234
  Notebook Bound: Yes
  Current Notebook: test.pluto.jl
```

#### `.clear`

Clear the terminal screen and show the welcome message again.

```
pluto> .clear
```

### Example Commands

The terminal includes built-in example commands for testing. See [TERMINAL-EXAMPLES.md](./TERMINAL-EXAMPLES.md) for details.

Quick examples:

- `.example-html` - Test HTML rendering
- `.example-image` - Test SVG graphics
- `.example-table` - Test table rendering
- `.example-plot` - Test plotting (requires Plots.jl)

## Output Rendering

### Rich Content (Webview)

The following MIME types automatically open in a webview panel:

- `text/html` - HTML content
- `image/png`, `image/jpeg`, `image/gif`, `image/svg+xml` - Images
- `application/vnd.plotly.v1+json` - Plotly plots
- `application/vnd.vegalite.v4+json` - Vega-Lite plots

Webviews support:

- Interactive HTML elements (buttons, forms, etc.)
- JavaScript execution
- Styled content
- Full image rendering

### Terminal Rendering

Plain text output is rendered directly in the terminal:

- `text/plain` - Plain text with ANSI colors
- `application/json` - Pretty-printed JSON

### Example Outputs

**HTML:**

```julia
pluto> HTML("<h1 style='color: blue;'>Hello World</h1>")
[Rich Output: text/html]
Opening in webview...
✓ Output displayed in webview
```

**Plot:**

```julia
pluto> using Plots; plot(sin, 0, 2π)
[Rich Output: image/png]
Opening in webview...
✓ Output displayed in webview
```

**Plain Text:**

```julia
pluto> println("Hello from Pluto!")
Hello from Pluto!
```

## Keyboard Shortcuts

- **Enter** - Execute current command
- **Ctrl+C** - Cancel current execution / Clear input
- **Backspace** - Delete previous character
- **Arrow Up** (`↑`) - Previous command in history
- **Arrow Down** (`↓`) - Next command in history

## Tips

1. **Code is ephemeral**: Commands executed in the terminal don't create notebook cells. They run temporarily and don't affect the notebook structure.

2. **Multiple terminals**: You can create multiple terminals, each connected to a different notebook.

3. **Rich output location**: Webview panels open beside the terminal by default. You can drag them to any location.

4. **History navigation**: Start typing a command, then use arrow keys to find similar commands. Your partial input is preserved.

5. **Error messages**: Errors are displayed in red in the terminal and also logged to the "Pluto Terminal" output channel.

6. **Server management**: The terminal automatically starts the Pluto server if needed. You can manually control it with commands like `Pluto: Start Server`.

## Architecture

### Components

1. **PlutoTerminalProvider** (`src/plutoTerminal.ts`)
   - Implements VSCode Pseudoterminal API
   - Handles user input and command execution
   - Manages command history
   - Routes output to terminal or webview

2. **TerminalOutputWebviewProvider** (`src/terminalOutputWebview.ts`)
   - Manages webview panels for rich content
   - Reuses existing Pluto renderer components
   - Handles HTML/JavaScript execution

3. **PlutoManager** (`src/plutoManager.ts`)
   - Manages Pluto server lifecycle
   - Creates and caches notebook workers
   - Executes code ephemerally

### Execution Flow

```
User Input
  ↓
handleInput() → Parse & validate
  ↓
executeCommand() → Get worker from PlutoManager
  ↓
executeCodeEphemeral() → Run code in Pluto
  ↓
renderOutput() → Check MIME type
  ↓
  ├─→ Rich content → TerminalOutputWebviewProvider
  │                    ↓
  │                  Webview with renderer
  │
  └─→ Plain text → renderInTerminal()
                    ↓
                  ANSI-formatted output
```

## Troubleshooting

### Terminal not connecting to notebook

**Problem**: Terminal shows "Not connected to a notebook"

**Solution**:

1. Check if any notebooks are open
2. Use `.connect` command
3. If no notebooks exist, create one first

### Output not rendering

**Problem**: Code executes but no output appears

**Solution**:

1. Check if code actually produces output
2. Try wrapping in `println()` or explicit return
3. Check "Pluto Terminal" output channel for errors

### Webview not opening

**Problem**: Rich content shows error instead of webview

**Solution**:

1. Check that extension context is properly initialized
2. Verify renderer files exist in `dist/` directory
3. Check for CSP (Content Security Policy) errors in Developer Tools

### Arrow keys not working

**Problem**: Arrow keys print characters instead of navigating history

**Solution**:

1. This shouldn't happen in VSCode integrated terminal
2. If it does, it may be a VSCode issue - try restarting
3. Command history is session-based; restarting terminal clears it

### Server won't start

**Problem**: "Failed to start Pluto server"

**Solution**:

1. Check if Julia is installed and in PATH
2. Check if Pluto.jl is installed: `julia -e "using Pluto"`
3. Check if port 1234 (default) is already in use
4. Check "Pluto Server" output channel for detailed errors

## Related Documentation

- [TERMINAL-EXAMPLES.md](./TERMINAL-EXAMPLES.md) - Example commands
- [MARKDOWN-CELLS.md](./MARKDOWN-CELLS.md) - Markdown cell handling
- [CLAUDE.md](../CLAUDE.md) - Project architecture

## Future Enhancements

Potential improvements:

- [ ] Persistent command history across sessions
- [ ] History search (Ctrl+R)
- [ ] Tab completion for Julia code
- [ ] Multi-line input support
- [ ] Syntax highlighting in input
- [ ] Output history/scrollback
- [ ] Export output to files
- [ ] Interrupt support for long-running code
