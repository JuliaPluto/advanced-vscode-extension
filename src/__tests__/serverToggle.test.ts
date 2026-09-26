import { jest } from "@jest/globals";
import * as vscode from "vscode";
import { PlutoManager, PlutoManagerLogger } from "../plutoManager.js";
import type { IPlutoServerManager, IFileReader } from "../plutoManagerTypes.js";
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
  let onStop: (() => void) | undefined;
  const server = {
    startCalls: 0,
    running: false,
    release: () => release(),
    start: async () => {
      server.startCalls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      server.running = true;
    },
    stop: async () => {
      if (server.running) {
        server.running = false;
        onStop?.();
      }
    },
    waitForReady: async () => {},
    onStop: (cb: () => void) => {
      onStop = cb;
    },
    onPortChanged: () => {},
    getActualPort: () => 1234,
    getServerUrl: () => "http://localhost:1234",
  };
  return server satisfies IPlutoServerManager;
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

  it("does not start a second time when clicked while starting", async () => {
    const started = manager.start();
    await tick();
    expect(manager.getState().status).toBe("starting");
    expect(item.tooltip).toContain("Click to stop once it is ready");

    const clicked = toggle();
    await tick();
    server.release();
    await Promise.all([started, clicked]);

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
