import { jest } from "@jest/globals";
import * as vscode from "vscode";
import { PlutoManager, PlutoManagerLogger } from "../plutoManager.js";
import type { IPlutoServer, IFileReader } from "../plutoManagerTypes.js";
import { toggleServer } from "../commands/plutoServerCommands.js";
import { PlutoStatusBar } from "../statusBar.js";

const logger: PlutoManagerLogger = {
  showWarningMessage: async () => undefined,
  showInfoMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};

const fileReader: IFileReader = { readFile: async () => "" };

/** A server whose launch finishes only when the test releases it */
function createGatedServer() {
  let release: () => void = () => {};
  const server = {
    startCalls: 0,
    running: false,
    release: () => release(),
    start: async (signal?: AbortSignal) => {
      server.startCalls++;
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
      server.running = true;
      return "http://localhost:1234";
    },
    stop: async () => {
      server.running = false;
    },
    onExit: () => {},
    writesNotebookFiles: true,
  };
  return server satisfies IPlutoServer;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("server toggle and status bar", () => {
  const realFetch = global.fetch;
  let server: ReturnType<typeof createGatedServer>;
  let manager: PlutoManager;
  let statusBar: PlutoStatusBar;
  let item: vscode.StatusBarItem;
  let toggle: () => Promise<void>;

  beforeAll(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
    })) as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  beforeEach(() => {
    server = createGatedServer();
    manager = new PlutoManager(1234, logger, server, fileReader);
    const created = vscode.window.createStatusBarItem();
    jest.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(created);
    item = created;
    statusBar = new PlutoStatusBar(manager);
    toggle = () => toggleServer(manager);
  });

  afterEach(() => {
    statusBar.dispose();
    jest.restoreAllMocks();
  });

  it("cancels the start when clicked while starting, never starting again", async () => {
    const started = manager.start();
    await tick();
    expect(manager.getState().status).toBe("starting");
    expect(item.tooltip).toContain("Click to cancel");

    await toggle();

    await expect(started).rejects.toThrow("cancelled");
    expect(server.startCalls).toBe(1);
    expect(manager.getState()).toEqual({ status: "stopped" });
    expect(item.tooltip).toContain("Click to start");
  });

  it("starts from stopped and stops from ready", async () => {
    const clicked = toggle();
    await tick();
    server.release();
    await clicked;
    expect(manager.getState().status).toBe("ready");
    expect(item.tooltip).toContain("Click to stop");

    await toggle();
    expect(manager.getState()).toEqual({ status: "stopped" });
    expect(server.startCalls).toBe(1);
  });

  it("offers a start after a failure and shows the reason", async () => {
    server.start = async () => {
      server.startCalls++;
      throw new Error("no julia");
    };
    await expect(manager.start()).rejects.toThrow("no julia");
    expect(item.tooltip).toBe("Pluto server failed: no julia\nClick to start");

    await toggle().catch(() => {});
    expect(server.startCalls).toBe(2);
  });
});
