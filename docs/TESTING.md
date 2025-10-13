# Testing Guide

## PlutoManager Tests

The PlutoManager tests use **comprehensive integration testing** with a real Pluto server.

### Test Approach

**Single Workflow Test** - One comprehensive test that:

- Opens a notebook
- Performs all operations sequentially
- Verifies each step works correctly
- Tests the complete lifecycle end-to-end

This approach provides:

- ✅ Realistic usage patterns
- ✅ Fast execution (no repeated setup/teardown)
- ✅ Clear verification of functionality
- ✅ Easy to understand workflow
- ✅ Real Pluto server interaction

### Test Setup

- **beforeAll**:
  - Starts Julia Pluto server on port 1234
  - Creates test notebook file
  - Creates PlutoManager instance

- **afterAll**:
  - Disposes PlutoManager
  - Cleans up test files
  - Kills Pluto server

### Test Coverage

**One comprehensive integration test** that verifies all functionality:

1. **Initial State** (Steps 1)
   - Manager not connected
   - No open notebooks
   - Server URL correct

2. **Connection** (Steps 2-3)
   - Connect to server
   - Verify duplicate connection handling

3. **Event System Setup** (Step 4)
   - Register event listeners
   - Prepare to track events

4. **Open Notebook** (Steps 5-7)
   - Get worker for notebook
   - Verify worker caching
   - Check open notebooks list
   - Verify notebookOpened event

5. **Cell Operations** (Steps 8-12)
   - Execute existing cell
   - Add new cell
   - Execute new cell
   - Delete cell
   - Execute ephemeral code

6. **Event Testing** (Step 13)
   - Emit cellUpdated event
   - Verify event received

7. **Multiple Notebooks** (Step 14)
   - Open second notebook with custom content
   - Verify different worker
   - Close second notebook
   - Verify notebookClosed event

8. **Event Listener Removal** (Step 15)
   - Add and remove listener
   - Verify listener not called

9. **Close Operations** (Steps 16-18)
   - Close main notebook
   - Verify removed from list
   - Test graceful error handling

10. **Error Handling** (Step 19)
    - Test missing file error

11. **Final State** (Step 20)
    - Verify still connected
    - No notebooks open

**Plus 2 constructor tests**:

- Default port initialization
- Custom server URL

### Running Tests

```bash
# Run all tests (in parallel by default)
npm test

# Run only PlutoManager tests
npm run test:unit -- plutoManager.test.ts

# Run with coverage
npm run test:coverage

# Run serially (for debugging)
npm run test:unit -- --runInBand plutoManager.test.ts
```

### Test Timeouts

- Main integration test: **2 minutes** (complete workflow)
- `beforeAll`: **2 minutes** (for Pluto server startup)
- `afterAll`: **30 seconds** (for cleanup)
- Constructor tests: **5 seconds** (default)

### Mocking Strategy

**What we mock:**

- `vscode` module - Only what's needed by PlutoServerTaskManager:
  - `workspace.getConfiguration` (for Julia settings)
  - Task-related types (TaskExecution, ShellExecution, etc.)
  - Notebook types (for serializer tests)

**What we DON'T mock:**

- ❌ Pluto server - use real Julia Pluto server
- ❌ File system - use real file operations
- ❌ @plutojl/rainbow - use real library
- ❌ PlutoServerTaskManager - use real implementation

This integration testing approach provides:

- ✅ More realistic test scenarios
- ✅ Better confidence in functionality
- ✅ Easier test maintenance
- ✅ Real interaction testing with Pluto
- ✅ Parallel test execution

### Prerequisites

**Local Development:**

- Julia 1.11+ must be installed and available in PATH
- Pluto.jl package must be installed: `julia -e 'using Pkg; Pkg.add("Pluto")'`

**CI/CD:**

- GitHub Actions CI automatically installs Julia 1.11 and Pluto.jl
- The test job uses `julia-actions/setup-julia@v2` to set up Julia
- Pluto.jl is installed before running tests

### Test Structure

**Sequential Workflow Test**:

```typescript
it("should perform complete notebook lifecycle workflow", async () => {
  // Step 1: Test initial state
  expect(manager.isConnected()).toBe(false);

  // Step 2: Connect to server
  await manager.connect();
  expect(manager.isConnected()).toBe(true);

  // Step 3-20: Sequential operations
  // - Open notebook
  // - Execute cells
  // - Add/delete cells
  // - Test events
  // - Close notebook
  // - Verify cleanup
}, 120000);
```

**Benefits of Sequential Testing**:

- ✅ Tests realistic usage patterns
- ✅ Verifies operations work together
- ✅ Faster than isolated tests (no repeated setup)
- ✅ Easy to follow workflow
- ✅ Clear failure points (which step failed)
