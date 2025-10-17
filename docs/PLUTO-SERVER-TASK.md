# Pluto Server as VSCode Task

The Pluto server can now be run as a VSCode task, providing better integration with the VSCode UI and terminal management.

## Benefits Over spawn()

### 1. **Integrated Terminal**

- Server runs in a dedicated VSCode terminal panel
- Full terminal UI with colors, formatting, and interactions
- Visible in the "Terminal" dropdown
- Can be brought to front or hidden as needed

### 2. **Task Management**

- Appears in VSCode's task list
- Can be stopped/restarted via Command Palette
- Task lifecycle managed by VSCode
- Consistent with other VSCode tasks (build, test, etc.)

### 3. **Better UX**

- Users can see server output in real-time
- Can interact with server output (copy, search, etc.)
- Automatic cleanup when VSCode closes
- Persistent across window reloads (if configured)

### 4. **Standard Integration**

- Follows VSCode extension best practices
- Similar to Jest extension, Python debugger, etc.
- Users familiar with VSCode tasks know how to interact with it

## Implementation

### PlutoServerTaskManager

New class in `src/plutoServerTask.ts` that manages the server as a VSCode task:

```typescript
export class PlutoServerTaskManager {
  async start(): Promise<void>; // Start server as task
  async stop(): Promise<void>; // Stop server task
  isRunning(): boolean; // Check if task is running
  getServerUrl(): string; // Get server URL
  waitForReady(): Promise<void>; // Wait for server to be ready
}
```

### PlutoManager Integration

`PlutoManager` now supports two modes:

1. **Task Mode** (default, recommended):

   ```typescript
   const manager = new PlutoManager(port, outputChannel, serverUrl, true);
   ```

2. **Spawn Mode** (legacy, for compatibility):
   ```typescript
   const manager = new PlutoManager(port, outputChannel, serverUrl, false);
   ```

The mode is controlled by the `useTasksForServer` parameter (defaults to `true`).

## Task Configuration

### Task Definition

```typescript
{
  type: "pluto-server",
  port: 1234
}
```

### Task Presentation

- **Reveal**: Always (shows terminal when task starts)
- **Panel**: Dedicated (uses dedicated terminal panel)
- **Focus**: False (doesn't steal focus)
- **Clear**: False (preserves previous output)
- **Show Reuse Message**: False (cleaner UI)

### Background Task

The task is configured as a background task (`isBackground: true`), meaning:

- Doesn't block other tasks
- Runs continuously
- Only stops when explicitly terminated

## Usage

### Starting the Server

When you open a Pluto notebook or run `Pluto: Start Server`:

1. VSCode creates a new task
2. Terminal panel opens (or switches to existing panel)
3. Julia command executes: `julia -e "using Pluto; Pluto.run(...)"`
4. Server output appears in real-time
5. After ~5 seconds, server is considered ready

### Viewing Server Output

- **Terminal Panel**: Click "Terminal" → Find "Pluto Server (port 1234)"
- **Task List**: Command Palette → "Tasks: Show Running Tasks"
- **Output**: Server logs appear in real-time with colors and formatting

### Stopping the Server

Three ways to stop:

1. **Command Palette**: `Pluto: Stop Server`
2. **Task Menu**: Tasks → Terminate Task → Pluto Server
3. **Terminal**: Click trash icon on terminal panel

## Server Ready Detection

Uses **HTTP polling** to detect when server is ready:

1. Task starts with Julia command
2. Extension polls `http://localhost:1234` every 1 second
3. When server responds (any response, even error), it's considered ready
4. Maximum wait time: 60 seconds
5. If server doesn't respond in time, task is terminated and error is thrown

**Why HTTP Polling?**

- More reliable than arbitrary timeout
- Works regardless of terminal output format
- Detects actual server availability (not just process start)
- VSCode tasks don't expose terminal output directly

**Alternative approaches considered:**

1. **Parse Terminal Output**: VSCode doesn't provide API to read task terminal output
2. **Custom Pseudoterminal**: Would require reimplementing task system
3. **Problem Matchers**: Only work for error detection, not ready state

## Comparison with spawn()

### spawn() Approach

```typescript
const julia = spawn("julia", ["-e", "using Pluto; Pluto.run(...)"]);

julia.stdout?.on("data", (data) => {
  outputChannel.appendLine(data.toString());
});

julia.stderr?.on("data", (data) => {
  outputChannel.appendLine(data.toString());
});
```

**Pros**:

- Direct control over process
- Can easily parse stdout/stderr
- Lower level, more flexible

**Cons**:

- Output hidden in Output Channel
- No integrated terminal UI
- User can't interact with output
- Not visible in task list
- Requires manual cleanup

### Task Approach

```typescript
const task = new vscode.Task(
  { type: "pluto-server" },
  vscode.TaskScope.Workspace,
  "Pluto Server",
  "pluto-notebook",
  new vscode.ShellExecution("julia", [...])
);

task.presentationOptions = { reveal: vscode.TaskRevealKind.Always };
await vscode.tasks.executeTask(task);
```

**Pros**:

- Integrated terminal UI
- User can see and interact with output
- Visible in task list
- Standard VSCode pattern
- Automatic cleanup
- Better UX

**Cons**:

- Harder to parse output
- Less direct control
- Requires VSCode task API knowledge

## Configuration

### Enable/Disable Task Mode

To switch back to spawn mode (not recommended):

```typescript
// In extension.ts
const plutoManager = getSharedPlutoManager(
  plutoPort,
  { ... },
  serverUrl || undefined,
  false  // Use spawn instead of tasks
);
```

### Future Configuration Option

Could add to `package.json`:

```json
{
  "pluto-notebook.useTasksForServer": {
    "type": "boolean",
    "default": true,
    "description": "Use VSCode tasks for Pluto server (recommended) instead of child process"
  }
}
```

## Testing

To test the task-based server:

1. Press `F5` to launch Extension Development Host
2. Open a Pluto notebook (`.pluto.jl` file)
3. Server starts automatically
4. Check "Terminal" panel - you should see "Pluto Server (port 1234)"
5. Terminal shows colored Julia output
6. Try stopping/restarting server via Command Palette

## Known Limitations

1. **Ready Detection**: Currently uses 5-second timeout (could be improved)
2. **Output Parsing**: Can't easily detect specific server messages
3. **Task Cleanup**: Relies on VSCode to clean up terminated tasks

## Future Enhancements

1. **Better Ready Detection**: Parse terminal output for "Go to" message
2. **Task Problem Matchers**: Add problem matchers for Julia errors
3. **Multiple Servers**: Support running multiple servers on different ports
4. **Task Provider**: Register a custom task provider for better integration
5. **Terminal Link Provider**: Make URLs in terminal clickable

## References

- [VSCode Task API](https://code.visualstudio.com/api/extension-guides/task-provider)
- [Jest Extension Task Implementation](https://github.com/jest-community/vscode-jest)
- [Terminal API](https://code.visualstudio.com/api/references/vscode-api#Terminal)
