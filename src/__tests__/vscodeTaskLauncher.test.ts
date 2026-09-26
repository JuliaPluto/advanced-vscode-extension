import { jest } from "@jest/globals";
import * as vscode from "./__mocks__/vscode.ts";
import { VscodeTaskLauncher } from "../plutoServerTask.ts";
import { PlutoServer, type JuliaToolchain } from "../server/plutoServer.ts";
import { findAvailablePort } from "../portUtils.ts";

const spec = { command: "julia", args: ["-e", "1"], env: {}, port: 1234 };

function foreignTask(port: number): vscode.TaskExecution {
  return new vscode.TaskExecution(
    new vscode.Task(
      { type: "pluto-server", port },
      vscode.TaskScope.Workspace,
      `Pluto Server (port ${port})`,
      "pluto-notebook",
      new vscode.ProcessExecution("julia", [])
    )
  );
}

describe("VscodeTaskLauncher", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
    })) as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vscode.tasks.taskExecutions.length = 0;
    jest.restoreAllMocks();
  });

  it("adopts a Pluto server task from an earlier extension host, once", async () => {
    const launcher = new VscodeTaskLauncher();
    vscode.tasks.taskExecutions.push(foreignTask(1240));

    const adopted = await launcher.adopt();

    expect(adopted?.port).toBe(1240);
    expect(await launcher.adopt()).toBeUndefined();
  });

  it("never adopts a task it launched itself, even while VS Code still lists it", async () => {
    const launcher = new VscodeTaskLauncher();
    const executeTask = jest.spyOn(vscode.tasks, "executeTask");
    await launcher.launch(spec);
    vscode.tasks.taskExecutions.push(
      (await executeTask.mock.results[0].value) as vscode.TaskExecution
    );

    expect(await launcher.adopt()).toBeUndefined();
  });

  it("reports the task's process end as the exit", async () => {
    const executeTask = jest.spyOn(vscode.tasks, "executeTask");
    const process = await new VscodeTaskLauncher().launch(spec);
    const execution = (await executeTask.mock.results[0]
      .value) as vscode.TaskExecution;
    const onExit = jest.fn();
    process.onExit(onExit);

    vscode.endTaskProcess(execution, 3);
    vscode.endTaskProcess(execution, 3);

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(3);
  });

  it("launches afresh right after a stop instead of adopting the stopped task", async () => {
    const executeTask = jest.spyOn(vscode.tasks, "executeTask");
    // VS Code keeps listing a task until its end is processed
    executeTask.mockImplementation(async (task) => {
      const execution = new vscode.TaskExecution(task);
      vscode.tasks.taskExecutions.push(execution);
      return execution;
    });
    const toolchain: JuliaToolchain = { command: "julia", args: [] };
    const server = new PlutoServer(
      new VscodeTaskLauncher(),
      async () => toolchain,
      {
        port: await findAvailablePort(
          30000 + Math.floor(Math.random() * 10000)
        ),
        writeNotebookFiles: false,
        update: true,
        readiness: { timeoutMs: 200, intervalMs: 10 },
        stopTimeoutMs: 20,
      },
      { warn: () => {} }
    );

    await server.start();
    await server.stop();
    await server.start();

    expect(executeTask).toHaveBeenCalledTimes(2);
  });
});
