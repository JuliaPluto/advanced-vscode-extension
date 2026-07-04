# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VSCode extension for Julia Pluto notebooks. Integrates with `@plutojl/rainbow` package for Pluto backend communication. Extension activates on `.jl` files and provides notebook interface for Pluto notebooks.

## Development Commands

### Build and Watch

```bash
npm run compile          # Type check, lint, and build once
npm run watch            # Watch mode (runs esbuild + tsc in parallel)
npm run package          # Production build (minified, no sourcemaps)
```

### Type Checking and Linting

```bash
npm run check-types      # TypeScript type checking only
npm run lint             # ESLint
```

### Testing

```bash
npm run test             # Run all tests
npm run compile-tests    # Compile tests to out/ directory
npm run watch-tests      # Watch mode for tests
```

### Debug

Press `F5` in VSCode to launch Extension Development Host window for testing.

## Architecture

### Core Components

**Extension Entry Point** (`src/extension.ts`)

- Activates on `onNotebook:pluto-notebook` event
- Registers `PlutoNotebookSerializer` for `.jl` file handling
- Registers `PlutoNotebookController` for cell execution
- All components added to context subscriptions for proper disposal

**Notebook Serializer** (`src/serializer.ts`)

- Implements `vscode.NotebookSerializer` interface
- Parses Pluto .jl format with cell markers (`# ╔═╡`), metadata, and reactive dependencies
- Converts between Pluto format and VSCode `NotebookData`/`NotebookCellData`
- Handles markdown cells wrapped in `md"""..."""`
- Supports both `.pluto.jl` and `.dyad.jl` file patterns

**Notebook Controller** (`src/controller.ts`)

- Implements notebook controller for cell execution
- Controller ID: `pluto-notebook-controller`
- Notebook type: `pluto-notebook`
- Supported language: `julia`
- Integrates with `@plutojl/rainbow` for real Pluto backend execution
- Handles reactive cell updates and dependencies
- Supports rich output rendering via custom notebook renderer

**PlutoManager** (`src/plutoManager.ts`)

- Manages Pluto server lifecycle (start, stop, restart)
- Creates and caches notebook workers
- Handles notebook opening, closing, and execution
- Supports both spawned server and VSCode task-based server
- Shared between extension and MCP server for consistent state

**MCP HTTP Server** (`src/mcp-server-http.ts`)

- HTTP-based MCP server for AI assistant integration
- Notebook management and code execution tools (see `packages/advanced-pluto-mcp/README.md` for the full list)
- Server-Sent Events (SSE) for streaming responses
- Health check endpoint for monitoring
- Shared PlutoManager instance with extension
- Also bundled into the `@plutojl/cli` npm package (`src/cli/`), driven from the terminal via `npx @plutojl/cli run|tools|call`

**Interactive Terminal** (`src/plutoTerminal.ts`)

- Pseudoterminal implementation for Julia code execution
- Command history with arrow key navigation
- Rich output rendering in webviews
- Special commands (.help, .connect, .status, etc.)
- Ephemeral execution without creating notebook cells

### Build System

Uses esbuild (`esbuild.js`) for bundling:

- Entry point: `src/extension.ts`
- Output: `dist/extension.js` (CommonJS format)
- External: `vscode` module (provided by VSCode runtime)
- Production: minified with no sourcemaps
- Development: sourcemaps enabled, watch mode available

TypeScript compilation targets Node16 module system and ES2022 with strict mode enabled.

## Key Implementation Notes

- **Pluto File Format**: Pluto notebooks are Julia files with special cell markers and metadata, not simple JSON
- **Reactive Evaluation**: Pluto uses reactive cell execution model - cells re-run when dependencies change
- **@plutojl/rainbow**: Package for communicating with Pluto server; needs integration in controller
- **Notebook Type**: Registered as `pluto-notebook` with `.jl` file pattern selector

### @plutojl/rainbow Usage

**IMPORTANT**: Always import the node polyfill first:

```typescript
import "@plutojl/rainbow/node-polyfill";
```

**Key API Patterns**:

1. **Creating Worker**: Always trim notebook content before passing to `createWorker`:

   ```typescript
   const worker = await host.createWorker(notebookContent.trim());
   await worker.connect();
   ```

2. **Executing Cells**:
   - For NEW cells: `worker.waitSnippet(index, code)` - takes index (number), returns CellResultData
   - For EXISTING cells: `worker.updateSnippetCode(cellId, code, run)` then `worker.wait(true)` then `worker.getSnippet(cellId)`

3. **Getting Cell Data**:
   - `worker.getSnippet(cellId)` returns `{ input: CellInputData, results: CellResultData }` or null
   - Use `cellData?.results` to access the output

4. **Minimal Valid Pluto Notebook Format**:

   ```julia
   ### A Pluto.jl notebook ###
   # v0.19.40

   using Markdown
   using InteractiveUtils

   # ╔═╡ <cell-uuid>
   md"""
   # Notebook Title
   """

   # ╔═╡ Cell order:
   # ╟─<cell-uuid>
   ```

5. **Markdown Cells**:
   - Pluto markdown cells are wrapped in `md"""..."""`
   - When deserializing, extract content from wrapper
   - When serializing, wrap markdown content back

## Current Status

The extension is functional and includes:

- ✅ Pluto notebook serializer and controller (registered and functional)
- ✅ PlutoManager for server lifecycle management
- ✅ Integration with @plutojl/rainbow for Pluto backend communication
- ✅ Real cell execution with reactive updates
- ✅ Rich output rendering (HTML, plots, images) via notebook renderer
- ✅ Interactive terminal for ephemeral code execution
- ✅ MCP HTTP server for AI assistant integration
- ✅ VSCode task integration for Pluto server
- ✅ Shared state between extension and MCP clients
- ✅ Extension can be debugged with F5
- ✅ Build system works correctly

## Implementation Status

**Completed:**

- Pluto server management with automatic lifecycle handling
- Real-time cell execution using @plutojl/rainbow
- Rich output rendering in notebooks and terminal webviews
- MCP server with notebook tools for AI assistants, shared with the `@plutojl/cli` command-line tool
- Interactive terminal with command history
- Configuration commands for Claude Desktop and GitHub Copilot

**In Progress:**

- Full Pluto .jl file format parsing in serializer (currently basic implementation)
- Complete reactive evaluation model support

## Future Enhancement Priorities

1. Enhance Pluto .jl file format parsing in serializer
2. Improve reactive dependency tracking
3. Add more PlutoUI component support
4. Enhance terminal capabilities (syntax highlighting, tab completion)
5. Add notebook diff/merge tools

### Rainbow usage example

```js
import "@plutojl/rainbow/node-polyfill";
import { spawn, ChildProcess } from "child_process";
import {
  Host,
  Worker,
  from_julia,
  getResult,
  resolveIncludes,
} from "@plutojl/rainbow";
import fs from "fs";

function runServer(port: number = 1234): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const julia = spawn("julia", [
      "-e",
      `using Pluto;Pluto.run(port=${port};require_secret_for_open_links=false, require_secret_for_access=false, launch_browser=false)`,
    ]);

    julia.stdout?.on("data", (data) => {
      console.log(`Julia stdout: ${data}`);
      if (data.toString().includes("Go to")) {
        resolve(julia);
      }
    });

    julia.stderr?.on("data", (data) => {
      const chunk = `${data}`;
      if (chunk.includes(port.toFixed(0))) {
        resolve(julia);
      }
    });

    julia.on("error", reject);
  });
}

async function runAnalysis(
  entryPoint: string = "../src/ElectricalComponents.jl",
  analysisName: string
): Promise<any> {
  const host = new Host("http://localhost:1234");

  try {
    const notebook = from_julia(resolveIncludes(fs, entryPoint), {
      DyadEcosystemDependencies: {
        uuid: "7bc808db-8006-421e-b546-062440d520b7",
        compat: "=0.10.3",
      },
    });
    console.log(`Notebook\n${notebook}`);
    fs.writeFileSync("notebook.jl", notebook);
    const worker = await host.createWorker(notebook.trim());
    await worker.connect();

    const result = await worker.waitSnippet(
      0,
      `begin
            solution = ${analysisName}()
            Dict(string(key) => DyadInterface.artifacts(solution, key) for key in DyadInterface.artifacts(solution))
        end`
    );

    return result;
  } catch (error) {
    console.error(`Failed to run analysis ${analysisName}:`, error);
    throw error;
  }
}

export { runServer, runAnalysis };
```
