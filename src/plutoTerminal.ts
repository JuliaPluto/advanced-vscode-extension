import * as vscode from "vscode";
import type { PlutoManager } from "./plutoManager.ts";
import { TerminalOutputWebviewProvider } from "./terminalOutputWebview.ts";
import {
  getExampleCommand,
  isExampleCommand,
  getExampleCommandsHelp,
} from "./terminalExamples.ts";
import { isDefined, isNotDefined } from "./helpers.ts";
import type { Worker } from "@plutojl/rainbow";

/**
 * Pluto Terminal - An interactive terminal for executing Julia code in Pluto notebooks
 * Uses executeCodeEphemeral to run code without creating persistent cells
 */
export class PlutoTerminalProvider implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  public readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  public readonly onDidClose?: vscode.Event<number | void> =
    this.closeEmitter.event;

  private notebookPath?: string;
  private inputBuffer = "";
  private cursorPosition = 0; // Position in the input buffer
  private isExecuting = false;
  // Bumped on Ctrl+C and on each new execution; stale executions compare
  // against it before touching shared terminal state
  private executionGeneration = 0;
  private readonly context?: vscode.ExtensionContext;

  // Command history
  private readonly commandHistory: string[] = [];
  private historyIndex = -1;
  private currentInput = "";

  constructor(
    private readonly plutoManager: PlutoManager,
    private readonly outputChannel: vscode.OutputChannel,
    context?: vscode.ExtensionContext
  ) {
    this.context = context;
  }

  /**
   * Called when the terminal is opened
   */
  public async open() // _initialDimensions: vscode.TerminalDimensions | undefined
  : Promise<void> {
    this.writeWelcomeMessage();

    // Try to bind to an open notebook
    await this.bindToNotebook();
  }

  /**
   * Write welcome message with ANSI colors
   */
  private writeWelcomeMessage(): void {
    this.write(
      "\x1b[1;36m╔═══════════════════════════════════════╗\x1b[0m\r\n"
    );
    this.write(
      "\x1b[1;36m║      Pluto Notebook Terminal          ║\x1b[0m\r\n"
    );
    this.write(
      "\x1b[1;36m╚═══════════════════════════════════════╝\x1b[0m\r\n\r\n"
    );
  }

  /**
   * Bind terminal to a notebook session
   */
  private async bindToNotebook(): Promise<void> {
    const notebooks = this.plutoManager.getOpenNotebooks();

    if (notebooks.length === 0) {
      // No notebooks open - ask user if they want to create one
      this.write("\x1b[33mNo notebooks currently open.\x1b[0m\r\n");
      this.write("Would you like to:\r\n");
      this.write("  1. Create a new notebook\r\n");
      this.write("  2. Open an existing notebook\r\n");
      this.write(
        "  3. Continue without a notebook (limited functionality)\r\n\r\n"
      );

      const choice = await vscode.window.showQuickPick(
        [
          { label: "Create New Notebook", value: "create" },
          { label: "Open Existing Notebook", value: "open" },
          { label: "Continue Without Notebook", value: "none" },
        ],
        { placeHolder: "Select an option" }
      );

      if (choice?.value === "create") {
        await this.createNewNotebook();
      } else if (choice?.value === "open") {
        await this.openExistingNotebook();
      } else {
        this.write("\x1b[33mContinuing without a notebook.\x1b[0m\r\n");
        this.write("\x1b[33mSome features may be limited.\x1b[0m\r\n\r\n");
      }
    } else if (notebooks.length === 1) {
      // One notebook - automatically bind to it
      this.notebookPath = notebooks[0].path;
      this.write(
        `\x1b[32m✓ Connected to notebook: ${this.getNotebookName()}\x1b[0m\r\n\r\n`
      );
    } else {
      // Multiple notebooks - ask user to select
      const items = notebooks.map((nb) => ({
        label: this.getNotebookNameFromPath(nb.path),
        description: nb.path,
        value: nb.path,
      }));

      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a notebook to connect to",
      });

      if (choice) {
        this.notebookPath = choice.value;
        this.write(
          `\x1b[32m✓ Connected to notebook: ${choice.label}\x1b[0m\r\n\r\n`
        );
      } else {
        this.write("\x1b[33mNo notebook selected.\x1b[0m\r\n\r\n");
      }
    }

    this.writePrompt();
  }

  /**
   * Create a new notebook
   */
  private async createNewNotebook(): Promise<void> {
    try {
      const uri = await vscode.window.showSaveDialog({
        filters: { "Pluto Notebooks": ["pluto.jl", "dyad.jl"] },
        defaultUri: vscode.Uri.file("Untitled.pluto.jl"),
      });

      if (uri) {
        // Create minimal Pluto notebook
        const minimalNotebook = `### A Pluto.jl notebook ###
# v0.19.40

using Markdown
using InteractiveUtils

# ╔═╡ Cell order:
# ╠═`;

        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(minimalNotebook, "utf-8")
        );

        // Open the notebook in VSCode
        const doc = await vscode.workspace.openNotebookDocument(uri);
        await vscode.window.showNotebookDocument(doc);

        // Bind to it
        this.notebookPath = uri.fsPath;
        this.write(
          `\x1b[32m✓ Created and connected to: ${this.getNotebookName()}\x1b[0m\r\n\r\n`
        );
      }
    } catch (error) {
      this.write(`\x1b[31mError creating notebook: ${error}\x1b[0m\r\n\r\n`);
    }
  }

  /**
   * Open an existing notebook
   */
  private async openExistingNotebook(): Promise<void> {
    try {
      const uris = await vscode.window.showOpenDialog({
        filters: { "Pluto Notebooks": ["pluto.jl", "dyad.jl", "jl"] },
        canSelectMany: false,
      });

      if (isDefined(uris?.[0])) {
        const doc = await vscode.workspace.openNotebookDocument(uris[0]);
        await vscode.window.showNotebookDocument(doc);

        this.notebookPath = uris[0].fsPath;
        this.write(
          `\x1b[32m✓ Opened and connected to: ${this.getNotebookName()}\x1b[0m\r\n\r\n`
        );
      }
    } catch (error) {
      this.write(`\x1b[31mError opening notebook: ${error}\x1b[0m\r\n\r\n`);
    }
  }

  /**
   * Get notebook name from path
   */
  private getNotebookName(): string {
    return this.notebookPath
      ? this.getNotebookNameFromPath(this.notebookPath)
      : "Unknown";
  }

  private getNotebookNameFromPath(path: string): string {
    return path.split("/").pop() ?? path;
  }

  /**
   * Write to terminal with \r\n line endings
   */
  private write(text: string): void {
    this.writeEmitter.fire(text);
  }

  /**
   * Write prompt
   */
  private writePrompt(): void {
    if (this.isExecuting) {
      return;
    }
    // Show connection status in prompt
    const status = this.notebookPath ? "" : "\x1b[33m[disconnected]\x1b[0m ";
    this.write(`${status}\x1b[1;32mjulia>\x1b[0m `);
  }

  /**
   * Handle input from the user
   */
  public handleInput(data: string): void {
    // Handle special keys
    if (data === "\r") {
      // Enter key - execute command
      this.write("\r\n");
      const command = this.inputBuffer.trim();
      this.inputBuffer = "";
      this.cursorPosition = 0;

      if (command) {
        // Add to history (avoid duplicates)
        if (
          this.commandHistory.length === 0 ||
          this.commandHistory[this.commandHistory.length - 1] !== command
        ) {
          this.commandHistory.push(command);
        }
        // Reset history navigation
        this.historyIndex = -1;
        this.currentInput = "";

        void this.executeCommand(command);
      } else {
        this.writePrompt();
      }
    } else if (data === "\x7f") {
      // Backspace - delete character before cursor
      if (this.cursorPosition > 0) {
        // Remove character at cursor position - 1
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPosition - 1) +
          this.inputBuffer.slice(this.cursorPosition);
        this.cursorPosition--;

        // Redraw line from cursor position
        this.redrawLine();
      }
    } else if (data === "\x03") {
      // Ctrl+C - interrupt
      if (this.isExecuting) {
        this.write("\r\n\x1b[31m^C\x1b[0m\r\n");
        // Invalidate the in-flight execution so its completion doesn't
        // clobber state or print a stray prompt (the Julia-side
        // computation itself is not cancelled — interrupt is a TODO)
        this.executionGeneration++;
        this.isExecuting = false;
        this.writePrompt();
      } else {
        this.inputBuffer = "";
        this.cursorPosition = 0;
        this.write("\r\n");
        this.writePrompt();
      }
    } else if (data === "\x1b[A") {
      // Arrow Up - previous command
      this.navigateHistory("up");
    } else if (data === "\x1b[B") {
      // Arrow Down - next command
      this.navigateHistory("down");
    } else if (data === "\x1b[C") {
      // Arrow Right - move cursor right
      if (this.cursorPosition < this.inputBuffer.length) {
        this.cursorPosition++;
        this.write("\x1b[C"); // Move cursor right
      }
    } else if (data === "\x1b[D") {
      // Arrow Left - move cursor left
      if (this.cursorPosition > 0) {
        this.cursorPosition--;
        this.write("\x1b[D"); // Move cursor left
      }
    } else if (data === "\x1b[3~") {
      // Delete key - delete character at cursor
      if (this.cursorPosition < this.inputBuffer.length) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPosition) +
          this.inputBuffer.slice(this.cursorPosition + 1);

        // Redraw line from cursor position
        this.redrawLine();
      }
    } else if (data === "\x1b[H" || data === "\x01") {
      // Home key or Ctrl+A - move to start
      this.moveCursorTo(0);
    } else if (data === "\x1b[F" || data === "\x05") {
      // End key or Ctrl+E - move to end
      this.moveCursorTo(this.inputBuffer.length);
    } else if (data.length > 0 && !data.startsWith("\x1b")) {
      // Regular printable character(s) or paste - insert at cursor position
      // Filter out non-printable characters except newlines
      const printable = data.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");

      if (printable.length > 0) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPosition) +
          printable +
          this.inputBuffer.slice(this.cursorPosition);
        this.cursorPosition += printable.length;

        // Redraw line from cursor position
        this.redrawLine();
      }
    }
  }

  /**
   * Redraw the current input line
   */
  private redrawLine(): void {
    // Save cursor position
    const savedCursor = this.cursorPosition;

    // Clear line and redraw
    this.clearCurrentLine();
    this.writePrompt();
    this.write(this.inputBuffer);

    // Move cursor back to saved position
    const distanceFromEnd = this.inputBuffer.length - savedCursor;
    if (distanceFromEnd > 0) {
      this.write(`\x1b[${distanceFromEnd}D`); // Move left N characters
    }
  }

  /**
   * Move cursor to specific position in input buffer
   */
  private moveCursorTo(position: number): void {
    const newPosition = Math.max(
      0,
      Math.min(position, this.inputBuffer.length)
    );
    const delta = newPosition - this.cursorPosition;

    if (delta > 0) {
      // Move right
      this.write(`\x1b[${delta}C`);
    } else if (delta < 0) {
      // Move left
      this.write(`\x1b[${-delta}D`);
    }

    this.cursorPosition = newPosition;
  }

  /**
   * Navigate command history
   */
  private navigateHistory(direction: "up" | "down"): void {
    if (this.commandHistory.length === 0) {
      return;
    }

    // Save current input when starting to navigate
    if (this.historyIndex === -1) {
      this.currentInput = this.inputBuffer;
    }

    if (direction === "up") {
      // Move to previous command
      if (this.historyIndex === -1) {
        // Start from the most recent command
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else {
      // Move to next command
      if (this.historyIndex !== -1) {
        this.historyIndex++;
        if (this.historyIndex >= this.commandHistory.length) {
          // Back to current input
          this.historyIndex = -1;
        }
      }
    }

    // Update input buffer with history or current input
    const newInput =
      this.historyIndex === -1
        ? this.currentInput
        : this.commandHistory[this.historyIndex];

    // Clear current line and write new input
    this.clearCurrentLine();
    this.writePrompt();
    this.inputBuffer = newInput;
    this.cursorPosition = newInput.length; // Cursor at end
    this.write(newInput);
  }

  /**
   * Clear the current input line
   */
  private clearCurrentLine(): void {
    // Move cursor to beginning of line, clear to end
    this.write("\r\x1b[K");
  }

  /**
   * Wait for worker to become idle
   */
  private async waitForIdle(worker: Worker): Promise<void> {
    const maxWaitTime = 2 * 60000; // 60 seconds max
    const checkInterval = 500; // Check every 500ms
    const startTime = Date.now();

    while (!worker.isIdle()) {
      // Check if we've exceeded max wait time
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(
          "Timeout waiting for notebook to become idle (60 seconds)"
        );
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, checkInterval));

      // Show progress indicator every 2 seconds
      if ((Date.now() - startTime) % 2000 < checkInterval) {
        this.write("\x1b[33m.\x1b[0m");
      }
    }

    this.write("\r\n");
  }

  /**
   * Execute Julia code in the notebook
   */
  private async executeCommand(code: string): Promise<void> {
    if (this.isExecuting) {
      this.write("\x1b[33mAlready executing...\x1b[0m\r\n");
      return;
    }

    // Handle special commands
    if (code.startsWith(".")) {
      if (!isExampleCommand(code)) {
        return await this.handleSpecialCommand(code);
      }

      // Example commands resolve to Julia code that runs like normal input
      code = this.handleExampleCommand(code);
      if (!code) {
        return;
      }
    }

    if (!this.notebookPath) {
      this.write("\x1b[31mError: Not connected to a notebook.\x1b[0m\r\n");
      this.write("Use .connect to connect to a notebook.\r\n\r\n");
      this.writePrompt();
      return;
    }

    this.isExecuting = true;
    const generation = ++this.executionGeneration;

    try {
      // Get worker from PlutoManager (it handles creation/caching)
      const worker = await this.plutoManager.getWorker(this.notebookPath);

      if (!worker) {
        throw new Error("Failed to get worker for notebook");
      }

      // Check if notebook is busy
      if (!worker.isIdle()) {
        this.write(
          "\x1b[33m⏳ Notebook is busy executing, waiting for turn...\x1b[0m\r\n"
        );

        // Wait for notebook to become idle
        await this.waitForIdle(worker);
      }

      // Execute code ephemerally using PlutoManager
      const result = await this.plutoManager.executeCodeEphemeral(worker, code);

      // Render output — unless the user cancelled with Ctrl+C meanwhile
      if (generation === this.executionGeneration) {
        await this.renderOutput(result);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(
        `Terminal execution error: ${errorMessage}`
      );
      if (generation === this.executionGeneration) {
        this.write(`\x1b[31mError: ${errorMessage}\x1b[0m\r\n`);
      }
    } finally {
      // A Ctrl+C (or a newer execution) already reclaimed the terminal —
      // a stale completion must not reset state or print another prompt
      if (generation === this.executionGeneration) {
        this.isExecuting = false;
        this.write("\r\n");
        this.writePrompt();
      }
    }
  }

  /**
   * Render cell output with support for various MIME types
   */
  private async renderOutput(result: any): Promise<void> {
    if (result?.output === null) {
      return;
    }

    const { mime, body } = result.output;

    if (isNotDefined(mime) || isNotDefined(body)) {
      return;
    }

    // Check if this should be shown in webview (rich content)
    const shouldUseWebview = this.shouldUseWebview(mime);

    if (shouldUseWebview && this.context) {
      // Show in webview using existing renderer
      this.write(`\x1b[36m[Rich Output: ${mime}]\x1b[0m\r\n`);
      this.write(`\x1b[2mOpening in webview...\x1b[0m\r\n`);

      try {
        TerminalOutputWebviewProvider.showLatestOutput(this.context, result);
        this.write(`\x1b[32m✓ Output displayed in webview\x1b[0m\r\n`);
      } catch (error) {
        this.write(`\x1b[31mError opening webview: ${error}\x1b[0m\r\n`);
        // Fallback to terminal rendering
        await this.renderInTerminal(mime, body);
      }
      return;
    }

    // Render in terminal
    await this.renderInTerminal(mime, body);
  }

  /**
   * Determine if output should be shown in webview
   */
  private shouldUseWebview(mime: string): boolean {
    const richMimeTypes = [
      "text/html",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/svg+xml",
      "application/vnd.plotly.v1+json",
      "application/vnd.vegalite.v4+json",
    ];
    return richMimeTypes.includes(mime);
  }

  /**
   * Render output in the terminal (text-based)
   */
  private async renderInTerminal(mime: string, body: any): Promise<void> {
    try {
      switch (mime) {
        case "text/plain":
          this.renderTextOutput(body);
          break;

        case "text/html":
          this.renderHtmlAsText(body);
          break;

        case "image/png":
        case "image/jpeg":
        case "image/gif":
        case "image/svg+xml":
          this.write(`\x1b[36m[Image: ${mime}]\x1b[0m\r\n`);
          this.write(`\x1b[2m(Image content not shown in terminal)\x1b[0m\r\n`);
          break;

        case "application/json":
          this.renderJsonOutput(body);
          break;

        default:
          // Fallback to text representation
          this.write(`\x1b[33m[Output: ${mime}]\x1b[0m\r\n`);
          if (typeof body === "string") {
            this.renderTextOutput(body);
          } else {
            this.renderTextOutput(JSON.stringify(body, null, 2));
          }
      }
    } catch (error) {
      this.write(`\x1b[31mError rendering output: ${error}\x1b[0m\r\n`);
    }
  }

  /**
   * Render plain text output
   */
  private renderTextOutput(text: string): void {
    const lines = text.split("\n");
    for (const line of lines) {
      this.write(line + "\r\n");
    }
  }

  /**
   * Render HTML output as text (simplified - extract text)
   */
  private renderHtmlAsText(html: string): void {
    // Strip HTML tags for terminal display
    const text = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p[^>]*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();

    this.write(`\x1b[36m[HTML Output]\x1b[0m\r\n`);
    this.renderTextOutput(text);

    // Offer to open in external viewer
    this.write(
      `\x1b[2m(Use .view to open HTML output in external viewer)\x1b[0m\r\n`
    );
  }

  /**
   * Render JSON output
   */
  private renderJsonOutput(json: any): void {
    this.write(`\x1b[36m[JSON Output]\x1b[0m\r\n`);
    const formatted =
      typeof json === "string" ? json : JSON.stringify(json, null, 2);
    this.renderTextOutput(formatted);
  }

  /**
   * Handle special terminal commands (starting with .)
   */
  private async handleSpecialCommand(command: string): Promise<void> {
    const cmd = command.toLowerCase().trim();

    switch (cmd) {
      case ".help":
        this.showHelp();
        break;

      case ".connect":
        await this.bindToNotebook();
        return;

      case ".disconnect":
        if (this.notebookPath) {
          // Note: PlutoManager keeps the worker alive for the notebook
          // We just remove our reference to it
          this.notebookPath = undefined;
          this.write("\x1b[33m✓ Disconnected from notebook\x1b[0m\r\n\r\n");
        } else {
          this.write("\x1b[33mNot connected to any notebook\x1b[0m\r\n\r\n");
        }
        break;

      case ".notebooks":
        this.listNotebooks();
        break;

      case ".clear":
        this.write("\x1b[2J\x1b[H"); // Clear screen and move cursor to top
        this.writeWelcomeMessage();
        break;

      case ".status":
        this.showStatus();
        break;

      default:
        this.write(`\x1b[31mUnknown command: ${cmd}\x1b[0m\r\n`);
        this.write("Type .help for available commands\r\n\r\n");
    }

    this.writePrompt();
  }

  /**
   * Show help message
   */
  private showHelp(): void {
    this.write("\x1b[1;36mPluto Terminal Commands:\x1b[0m\r\n");
    this.write("  .help        - Show this help message\r\n");
    this.write("  .connect     - Connect to a notebook\r\n");
    this.write("  .disconnect  - Disconnect from current notebook\r\n");
    this.write("  .notebooks   - List open notebooks\r\n");
    this.write("  .status      - Show terminal status\r\n");
    this.write("  .clear       - Clear the terminal\r\n");
    this.write("\r\n");
    this.write(getExampleCommandsHelp());
    this.write("\r\n");
    this.write("\x1b[1;36mTips:\x1b[0m\r\n");
    this.write("  - Type Julia code to execute it in the notebook\r\n");
    this.write("  - Press Ctrl+C to cancel current execution\r\n");
    this.write("  - Code is executed ephemerally (no cells created)\r\n");
    this.write("\r\n");
  }

  /**
   * List open notebooks
   */
  private listNotebooks(): void {
    const notebooks = this.plutoManager.getOpenNotebooks();

    if (notebooks.length === 0) {
      this.write("\x1b[33mNo notebooks currently open\x1b[0m\r\n\r\n");
      return;
    }

    this.write("\x1b[1;36mOpen Notebooks:\x1b[0m\r\n");
    for (const nb of notebooks) {
      const name = this.getNotebookNameFromPath(nb.path);
      const isConnected =
        nb.path === this.notebookPath ? " \x1b[32m✓\x1b[0m" : "";
      this.write(`  - ${name}${isConnected}\r\n`);
      this.write(`    \x1b[2m${nb.path}\x1b[0m\r\n`);
    }
    this.write("\r\n");
  }

  /**
   * Handle example commands
   */
  private handleExampleCommand(command: string): string {
    const example = getExampleCommand(command);
    if (!example) {
      this.write(
        `\x1b[31mExample command not found: ${command}\x1b[0m\r\n\r\n`
      );
      this.writePrompt();
      return "";
    }

    this.write(`\x1b[36m▶ Running example: ${example.description}\x1b[0m\r\n`);
    this.write(
      `\x1b[2m${example.code.substring(0, 60)}${
        example.code.length > 60 ? "..." : ""
      }\x1b[0m\r\n\r\n`
    );

    return example.code;
  }

  /**
   * Show terminal status
   */
  private showStatus(): void {
    this.write("\x1b[1;36mTerminal Status:\x1b[0m\r\n");

    // Server status from PlutoManager
    const serverStatus = this.plutoManager.isRunning();
    const serverConnected = this.plutoManager.isConnected();

    this.write(
      `  Server: ${
        serverStatus ? "\x1b[32mRunning\x1b[0m" : "\x1b[31mStopped\x1b[0m"
      }\r\n`
    );
    this.write(
      `  Server Connected: ${
        serverConnected ? "\x1b[32mYes\x1b[0m" : "\x1b[31mNo\x1b[0m"
      }\r\n`
    );
    this.write(`  Server URL: ${this.plutoManager.getServerUrl()}\r\n`);
    this.write(
      `  Notebook Bound: ${
        this.notebookPath ? "\x1b[32mYes\x1b[0m" : "\x1b[31mNo\x1b[0m"
      }\r\n`
    );
    if (this.notebookPath) {
      this.write(`  Notebook Path: ${this.notebookPath}\r\n`);
      this.write(`  Notebook Name: ${this.getNotebookName()}\r\n`);
    }
    this.write(
      `  Executing: ${
        this.isExecuting ? "\x1b[33mYes\x1b[0m" : "\x1b[32mNo\x1b[0m"
      }\r\n`
    );

    // Show open notebooks count
    const openNotebooks = this.plutoManager.getOpenNotebooks();
    this.write(`  Open Notebooks: ${openNotebooks.length}\r\n`);

    this.write("\r\n");
  }

  /**
   * Close the terminal
   */
  public close(): void {
    this.closeEmitter.fire();
  }
}

/**
 * Create and show a Pluto terminal
 */
export function createPlutoTerminal(
  plutoManager: PlutoManager,
  outputChannel: vscode.OutputChannel,
  context: vscode.ExtensionContext
): vscode.Terminal {
  const pty = new PlutoTerminalProvider(plutoManager, outputChannel, context);

  const terminal = vscode.window.createTerminal({
    name: "Pluto Terminal",
    pty,
    iconPath: new vscode.ThemeIcon("symbol-namespace"),
  });

  terminal.show();
  return terminal;
}
