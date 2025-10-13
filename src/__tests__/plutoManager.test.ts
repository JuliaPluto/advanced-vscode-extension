import { PlutoManager, PlutoManagerLogger } from "../plutoManager.js";
import { spawn, ChildProcess, execSync } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("PlutoManager Integration Tests", () => {
  let plutoProcess: ChildProcess | null = null;
  let testNotebookPath: string;
  let manager: PlutoManager;
  let mockLogger: PlutoManagerLogger;

  const TEST_PORT = 1234;
  const SERVER_URL = `http://localhost:${TEST_PORT}`;
  const MINIMAL_NOTEBOOK = `### A Pluto.jl notebook ###
# v0.19.40

using Markdown
using InteractiveUtils

# ╔═╡ b2d786ec-7f73-11ea-1a0c-f38d7b6bbc1e
md"""
# Integration Test Notebook
"""

# ╔═╡ b2d79330-7f73-11ea-0d1c-a9aad1efaae1
x = 42

# ╔═╡ Cell order:
# ╟─b2d786ec-7f73-11ea-1a0c-f38d7b6bbc1e
# ╠═b2d79330-7f73-11ea-0d1c-a9aad1efaae1
`;

  // Start Pluto server and create test notebook before all tests
  beforeAll(async () => {
    console.log("[TEST] Starting Pluto server setup...");

    // Ensure port is free before starting
    try {
      execSync("fuser -k 1234/tcp 2>/dev/null || true", { stdio: "ignore" });
      console.log("[TEST] Ensured port 1234 is free");
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for port to be fully released
    } catch {
      // Ignore errors
    }

    // Create test directory and notebook
    const testDir = join(tmpdir(), "pluto-test-integration");
    await mkdir(testDir, { recursive: true });
    testNotebookPath = join(testDir, `test-notebook-${Date.now()}.jl`);
    await writeFile(testNotebookPath, MINIMAL_NOTEBOOK);
    console.log(`[TEST] Created test notebook at: ${testNotebookPath}`);

    // Start Pluto server
    console.log(`[TEST] Spawning Julia Pluto server on port ${TEST_PORT}...`);
    plutoProcess = spawn("julia", [
      "-e",
      `using Pluto; Pluto.run(port=${TEST_PORT}; require_secret_for_open_links=false, require_secret_for_access=false, launch_browser=false)`,
    ]);

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      const safeResolve = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      };
      const safeReject = (error: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(error);
        }
      };

      const timeout = setTimeout(() => {
        safeReject(
          new Error(
            "Pluto server failed to start within 90 seconds. Check Julia output above for errors."
          )
        );
      }, 90000);

      let stdoutBuffer = "";
      let stderrBuffer = "";

      plutoProcess?.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutBuffer += output;
        console.log(`[JULIA STDOUT] ${output}`);

        if (output.includes("Go to") || output.includes("localhost")) {
          console.log("[TEST] Detected server ready message in stdout");
          safeResolve();
        }
      });

      plutoProcess?.stderr?.on("data", (data: Buffer) => {
        const output = data.toString();
        stderrBuffer += output;
        console.log(`[JULIA STDERR] ${output}`);

        // Check for errors first - if we see ERROR or EADDRINUSE, don't resolve
        if (output.includes("ERROR:") || output.includes("EADDRINUSE")) {
          console.error("[TEST] Error detected in Julia stderr");
          safeReject(
            new Error(`Pluto server failed to start. Error: ${output}`)
          );
          return;
        }

        // Accept specific success messages (Pluto outputs "Go to" in stderr)
        if (
          output.includes("Go to http://") ||
          output.includes("Listening on") ||
          output.includes("server listening")
        ) {
          console.log("[TEST] Detected server ready message in stderr");
          safeResolve();
        }
      });

      plutoProcess?.on("error", (error: Error) => {
        console.error("[TEST] Julia process error:", error);
        safeReject(error);
      });

      plutoProcess?.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.error(
            `[TEST] Julia process exited unexpectedly with code ${code}`
          );
          safeReject(
            new Error(
              `Julia process exited with code ${code}. STDOUT: ${stdoutBuffer}. STDERR: ${stderrBuffer}`
            )
          );
        }
      });
    });

    // Give extra time to initialize
    console.log(
      "[TEST] Server detected as ready, waiting 5 seconds for full initialization..."
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Create mock logger
    mockLogger = {
      showWarningMessage: async () => undefined,
      showInfoMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    };

    // Create PlutoManager instance
    console.log("[TEST] Creating PlutoManager instance...");
    manager = new PlutoManager(TEST_PORT, mockLogger, SERVER_URL);
    console.log("[TEST] PlutoManager setup complete!");
  }, 150000);

  // Cleanup after all tests
  afterAll(async () => {
    console.log("[TEST] Starting cleanup...");

    // Dispose manager
    if (manager) {
      console.log("[TEST] Disposing PlutoManager...");
      try {
        await manager.dispose();
      } catch (error) {
        console.error("[TEST] Error disposing manager:", error);
      }
    }

    // Kill Pluto process first
    if (plutoProcess && !plutoProcess.killed) {
      console.log("[TEST] Killing Julia Pluto process...");
      plutoProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (!plutoProcess.killed) {
        console.log("[TEST] Force killing Julia process...");
        plutoProcess.kill("SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Extra safety: kill any process on port 1234
    try {
      execSync("fuser -k 1234/tcp 2>/dev/null || true", { stdio: "ignore" });
      console.log("[TEST] Ensured port 1234 is free");
    } catch {
      // Ignore errors
    }

    // Cleanup test files
    try {
      await unlink(testNotebookPath);
      console.log("[TEST] Cleaned up test notebook");
    } catch {
      // Ignore errors
    }

    console.log("[TEST] Cleanup complete");
  }, 60000);

  it("should perform complete notebook lifecycle workflow", async () => {
    console.log("[TEST] Starting comprehensive workflow test...");

    // Step 1: Test initial state
    console.log("[TEST] Step 1: Testing initial state...");
    expect(manager.isConnected()).toBe(false);
    expect(manager.isRunning()).toBe(false);
    expect(manager.getServerUrl()).toBe(SERVER_URL);
    expect(manager.getOpenNotebooks()).toEqual([]);

    // Step 2: Connect to Pluto server
    console.log("[TEST] Step 2: Connecting to Pluto server...");
    await manager.connect();
    console.log("[TEST] Connected successfully!");
    expect(manager.isConnected()).toBe(true);

    // Step 3: Verify duplicate connection doesn't create new host
    await manager.connect();
    expect(manager.isConnected()).toBe(true);

    // Step 4: Test event system - setup listeners
    const notebookOpenedEvents: string[] = [];
    const notebookClosedEvents: string[] = [];
    const cellUpdatedEvents: Array<{ path: string; cellId: string }> = [];

    manager.on("notebookOpened", (path) => {
      notebookOpenedEvents.push(path);
    });

    manager.on("notebookClosed", (path) => {
      notebookClosedEvents.push(path);
    });

    manager.on("cellUpdated", (path, cellId) => {
      cellUpdatedEvents.push({ path, cellId });
    });

    // Step 5: Open notebook and get worker
    console.log("[TEST] Step 5: Opening notebook and getting worker...");
    const worker = await manager.getWorker(testNotebookPath);
    console.log(`[TEST] Worker obtained: ${worker?.notebook_id}`);
    expect(worker).toBeDefined();
    expect(worker?.notebook_id).toBeDefined();

    // Verify event was emitted
    expect(notebookOpenedEvents).toContain(testNotebookPath);

    // Step 6: Verify worker is cached (returns same instance)
    const worker2 = await manager.getWorker(testNotebookPath);
    expect(worker2).toBe(worker);
    expect(worker2?.notebook_id).toBe(worker?.notebook_id);

    // Step 7: Verify notebook appears in open notebooks list
    let openNotebooks = manager.getOpenNotebooks();
    expect(openNotebooks.length).toBeGreaterThan(0);
    const openNotebook = openNotebooks.find((n) => n.path === testNotebookPath);
    expect(openNotebook).toBeDefined();
    expect(openNotebook?.notebookId).toBe(worker?.notebook_id);

    // Step 8: Execute existing cell
    if (worker) {
      const cellId = "b2d79330-7f73-11ea-0d1c-a9aad1efaae1";
      const result = await manager.executeCell(worker, cellId, "2 + 2");
      expect(result).toBeDefined();
    }

    // Step 9: Add a new cell
    if (worker) {
      const newCellId = await manager.addCell(worker, 0, "y = 100");
      expect(newCellId).toBeDefined();
      expect(typeof newCellId).toBe("string");

      // Step 10: Execute the new cell
      const newCellResult = await manager.executeCell(
        worker,
        newCellId,
        "y * 2"
      );
      expect(newCellResult).toBeDefined();

      // Step 11: Delete the cell we just added
      await expect(
        manager.deleteCell(worker, newCellId)
      ).resolves.not.toThrow();
    }

    // Step 12: Execute code ephemerally (without creating permanent cell)
    if (worker) {
      const ephemeralResult = await manager.executeCodeEphemeral(
        worker,
        "5 * 5"
      );
      expect(ephemeralResult).toBeDefined();
      expect(ephemeralResult.cell_id).toBeDefined();
    }

    // Step 13: Test cellUpdated event emission
    manager.emitCellUpdated(testNotebookPath, "test-cell-id");
    expect(cellUpdatedEvents).toContainEqual({
      path: testNotebookPath,
      cellId: "test-cell-id",
    });

    // Step 14: Test worker with custom content (different path)
    const customNotebookPath = testNotebookPath.replace(".jl", "-custom.jl");
    const customContent = MINIMAL_NOTEBOOK.replace("x = 42", "z = 999");
    await writeFile(customNotebookPath, customContent);

    try {
      const customWorker = await manager.getWorker(
        customNotebookPath,
        customContent
      );
      expect(customWorker).toBeDefined();
      expect(customWorker?.notebook_id).not.toBe(worker?.notebook_id);

      // Close the custom notebook
      // CALUADE THIS IS THE LINE WHere all goes south
      await manager.closeNotebook(customNotebookPath);
      expect(notebookClosedEvents).toContain(customNotebookPath);
    } finally {
      await unlink(customNotebookPath).catch(() => {});
    }

    // Step 15: Test event listener removal
    const removableListener = (path: string) => {
      notebookOpenedEvents.push(`removable-${path}`);
    };
    manager.on("notebookOpened", removableListener);
    manager.off("notebookOpened", removableListener);

    // Open another notebook to verify listener was removed
    const anotherNotebookPath = testNotebookPath.replace(".jl", "-another.jl");
    await writeFile(anotherNotebookPath, MINIMAL_NOTEBOOK);

    try {
      await manager.getWorker(anotherNotebookPath);
      const removableEvents = notebookOpenedEvents.filter((e) =>
        e.startsWith("removable-")
      );
      expect(removableEvents).toEqual([]);
    } finally {
      await manager.closeNotebook(anotherNotebookPath);
      await unlink(anotherNotebookPath).catch(() => {});
    }

    // Step 16: Close the main notebook
    await manager.closeNotebook(testNotebookPath);
    expect(notebookClosedEvents).toContain(testNotebookPath);

    // Step 17: Verify notebook removed from open list
    openNotebooks = manager.getOpenNotebooks();
    const closedNotebook = openNotebooks.find(
      (n) => n.path === testNotebookPath
    );
    expect(closedNotebook).toBeUndefined();

    // Step 18: Test graceful handling of closing non-existent notebook
    await expect(
      manager.closeNotebook("/nonexistent/notebook.jl")
    ).resolves.not.toThrow();

    // Step 19: Test error handling for missing files
    await expect(
      manager.getWorker("/nonexistent/path/notebook.jl")
    ).rejects.toThrow();

    // Step 20: Verify final state
    console.log("[TEST] Step 20: Verifying final state...");
    expect(manager.isConnected()).toBe(true);
    expect(manager.getOpenNotebooks().length).toBe(0);
    console.log("[TEST] All steps completed successfully!");
  }, 180000);

  describe("constructor tests", () => {
    it("should initialize with default port", () => {
      const logger: PlutoManagerLogger = {
        showWarningMessage: async () => undefined,
        showInfoMessage: async () => undefined,
        showErrorMessage: async () => undefined,
      };
      const testManager = new PlutoManager(TEST_PORT, logger);
      expect(testManager.getServerUrl()).toBe(SERVER_URL);
    });

    it("should initialize with custom server URL", () => {
      const logger: PlutoManagerLogger = {
        showWarningMessage: async () => undefined,
        showInfoMessage: async () => undefined,
        showErrorMessage: async () => undefined,
      };
      const customUrl = "http://custom-server:5678";
      const testManager = new PlutoManager(TEST_PORT, logger, customUrl);
      expect(testManager.getServerUrl()).toBe(customUrl);
    });
  });
});
