import { jest } from "@jest/globals";
import {
  PlutoManager,
  PlutoManagerLogger,
  type ServerState,
} from "../plutoManager.js";
import type { IPlutoServerManager, IFileReader } from "../plutoManagerTypes.js";
import { Host, Worker } from "@plutojl/rainbow";

type ServerStatus = ServerState["status"];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createMockLogger(): PlutoManagerLogger {
  return {
    showWarningMessage: jest.fn(async () => undefined),
    showInfoMessage: jest.fn(async () => undefined),
    showErrorMessage: jest.fn(async () => undefined),
  };
}

interface MockServerManager extends IPlutoServerManager {
  startCalls: number;
  running: boolean;
  triggerStop: () => void;
}

function createMockServerManager(startDelayMs = 20): MockServerManager {
  let onStopCallback: (() => void) | undefined;
  const manager: MockServerManager = {
    startCalls: 0,
    running: false,
    triggerStop: () => {
      manager.running = false;
      onStopCallback?.();
    },
    start: async () => {
      manager.startCalls++;
      if (manager.running) {
        return;
      }
      await delay(startDelayMs);
      manager.running = true;
    },
    stop: async () => {
      // Like real managers, the process exit fires the stop callback
      // before stop() resolves
      if (manager.running) {
        manager.triggerStop();
      }
    },
    waitForReady: async () => {},
    onStop: (cb: () => void) => {
      onStopCallback = cb;
    },
    onPortChanged: () => {},
    getActualPort: () => 1234,
    getServerUrl: () => "http://localhost:1234",
  };
  return manager;
}

const stubFileReader: IFileReader = {
  readFile: async () => "### A Pluto.jl notebook ###",
};

function createFakeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    notebook_id: "fake-notebook-id",
    connected: true,
    connect: jest.fn(async () => true),
    shutdown: jest.fn(async () => undefined),
    moveTo: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as Worker;
}

describe("PlutoManager concurrency", () => {
  // connect() probes the server URL; no real server exists in these tests
  const realFetch = global.fetch;
  beforeAll(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
    })) as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("start()", () => {
    it("shares one in-flight start between concurrent callers", async () => {
      const serverManager = createMockServerManager(30);
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );

      await Promise.all([manager.start(), manager.start(), manager.start()]);

      expect(serverManager.startCalls).toBe(1);
      expect(manager.isConnected()).toBe(true);
    });

    it("does not start again when the server is already running", async () => {
      const serverManager = createMockServerManager(1);
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );

      await manager.start();
      await manager.start();

      expect(serverManager.startCalls).toBe(1);
    });

    it("allows retry after a failed start", async () => {
      const serverManager = createMockServerManager(1);
      const originalStart = serverManager.start;
      let failNext = true;
      serverManager.start = async () => {
        serverManager.startCalls++;
        if (failNext) {
          failNext = false;
          throw new Error("boom");
        }
        serverManager.running = true;
      };

      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );

      await expect(manager.start()).rejects.toThrow("boom");
      await manager.start();

      expect(serverManager.startCalls).toBe(2);
      void originalStart;
    });
  });

  describe("stop()", () => {
    it("does not warn about unexpected stop during intentional stop", async () => {
      const serverManager = createMockServerManager(1);
      const logger = createMockLogger();
      const manager = new PlutoManager(
        1234,
        logger,
        serverManager,
        stubFileReader
      );

      await manager.start();
      await manager.stop();

      expect(logger.showErrorMessage).not.toHaveBeenCalled();
    });

    it("warns when the server stops unexpectedly", async () => {
      const serverManager = createMockServerManager(1);
      const logger = createMockLogger();
      const manager = new PlutoManager(
        1234,
        logger,
        serverManager,
        stubFileReader
      );

      await manager.start();
      serverManager.triggerStop();

      expect(logger.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("stopped unexpectedly"),
        expect.anything()
      );
    });
  });

  describe("getWorker()", () => {
    // Non-local server URL skips the unlink/moveTo filesystem step
    const remoteUrl = "http://10.0.0.99:1234";

    it("shares one in-flight creation between concurrent callers", async () => {
      const fakeWorker = createFakeWorker();
      const createWorkerSpy = jest
        .spyOn(Host.prototype, "createWorker")
        .mockImplementation(async () => {
          await delay(30);
          return fakeWorker;
        });

      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        createMockServerManager(1),
        stubFileReader,
        remoteUrl
      );

      const [a, b] = await Promise.all([
        manager.getWorker("/tmp/nb.pluto.jl"),
        manager.getWorker("/tmp/nb.pluto.jl"),
      ]);

      expect(createWorkerSpy).toHaveBeenCalledTimes(1);
      expect(a).toBe(fakeWorker);
      expect(b).toBe(fakeWorker);
      expect(manager.getOpenNotebooks()).toHaveLength(1);
    });

    it("creates separate workers for different notebooks", async () => {
      jest
        .spyOn(Host.prototype, "createWorker")
        .mockImplementation(async () => createFakeWorker());

      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        createMockServerManager(1),
        stubFileReader,
        remoteUrl
      );

      const [a, b] = await Promise.all([
        manager.getWorker("/tmp/one.pluto.jl"),
        manager.getWorker("/tmp/two.pluto.jl"),
      ]);

      expect(a).not.toBe(b);
      expect(manager.getOpenNotebooks()).toHaveLength(2);
    });

    it("shuts down the worker and allows retry when connect fails", async () => {
      const failing = createFakeWorker({
        connect: jest.fn(async () => {
          throw new Error("no route");
        }),
      } as Partial<Worker>);
      const working = createFakeWorker();
      const createWorkerSpy = jest
        .spyOn(Host.prototype, "createWorker")
        .mockResolvedValueOnce(failing)
        .mockResolvedValueOnce(working);

      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        createMockServerManager(1),
        stubFileReader,
        remoteUrl
      );

      await expect(manager.getWorker("/tmp/nb.pluto.jl")).rejects.toThrow(
        "no route"
      );
      expect(failing.shutdown).toHaveBeenCalled();

      const worker = await manager.getWorker("/tmp/nb.pluto.jl");
      expect(worker).toBe(working);
      expect(createWorkerSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("server state", () => {
    const NOTEBOOK_ID = "0b6c8e0e-7d1c-4b8e-9d1f-3e0c7c6b2a11";
    const NOTEBOOK = "/tmp/state.pluto.jl";

    function recordStates(manager: PlutoManager): ServerStatus[] {
      const seen: ServerStatus[] = [];
      manager.on("serverStateChanged", (state) => seen.push(state.status));
      return seen;
    }

    // A local server opens notebooks by path: POST /open answers the id
    function serveLocalNotebooks(): void {
      global.fetch = jest.fn(async () => ({
        ok: true,
        text: async () => NOTEBOOK_ID,
      })) as unknown as typeof fetch;
      jest.spyOn(Host.prototype, "workers").mockResolvedValue([]);
      const worker = createFakeWorker({ notebook_id: NOTEBOOK_ID });
      jest.spyOn(Host.prototype, "worker").mockReturnValue(worker);
    }

    it("moves stopped → starting → ready, carrying the URL", async () => {
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        createMockServerManager(1),
        stubFileReader
      );
      const seen = recordStates(manager);

      expect(manager.getState()).toEqual({ status: "stopped" });
      await manager.start();

      expect(seen).toEqual(["starting", "ready"]);
      expect(manager.getState()).toEqual({
        status: "ready",
        url: "http://localhost:1234",
      });
    });

    it("connect() to a configured URL reports starting → ready", async () => {
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        createMockServerManager(1),
        stubFileReader,
        "http://10.0.0.99:1234"
      );
      const seen = recordStates(manager);

      await manager.connect();

      expect(seen).toEqual(["starting", "ready"]);
      expect(manager.getState()).toEqual({
        status: "ready",
        url: "http://10.0.0.99:1234",
      });
    });

    it("keeps a configured URL when the server manager reports a port", async () => {
      const serverManager = createMockServerManager(1);
      let reportPort: (port: number) => void = () => {};
      serverManager.onPortChanged = (cb) => {
        reportPort = cb;
      };
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader,
        "http://10.0.0.99:1234"
      );

      reportPort(1235);
      await manager.start();

      expect(manager.getServerUrl()).toBe("http://10.0.0.99:1234");
      expect(manager.getState()).toMatchObject({
        url: "http://10.0.0.99:1234",
      });
    });

    it("moves to failed with the reason when the start fails", async () => {
      const serverManager = createMockServerManager(1);
      serverManager.start = async () => {
        throw new Error("julia exploded");
      };
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      const seen = recordStates(manager);

      await expect(manager.start()).rejects.toThrow("julia exploded");

      expect(seen).toEqual(["starting", "failed"]);
      expect(manager.getState()).toEqual({
        status: "failed",
        url: "http://localhost:1234",
        reason: "julia exploded",
      });
    });

    it("moves ready → failed when the server exits unexpectedly", async () => {
      const serverManager = createMockServerManager(1);
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      await manager.start();
      const seen = recordStates(manager);

      serverManager.triggerStop();

      expect(seen).toEqual(["failed"]);
      expect(manager.getState()).toMatchObject({
        status: "failed",
        reason: expect.stringContaining("stopped unexpectedly"),
      });
      expect(manager.isConnected()).toBe(false);
    });

    it("moves ready → stopping → stopped on stop()", async () => {
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        createMockServerManager(1),
        stubFileReader
      );
      await manager.start();
      const seen = recordStates(manager);

      await manager.stop();

      expect(seen).toEqual(["stopping", "stopped"]);
    });

    it("stops a server that is starting once the start settles", async () => {
      const serverManager = createMockServerManager(30);
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      const seen = recordStates(manager);

      const started = manager.start();
      await delay(5);
      expect(manager.getState().status).toBe("starting");
      await Promise.all([started, manager.stop()]);

      expect(serverManager.startCalls).toBe(1);
      expect(seen).toEqual(["starting", "ready", "stopping", "stopped"]);
      expect(serverManager.running).toBe(false);
    });

    it("starts a server that is stopping once the stop settles", async () => {
      const serverManager = createMockServerManager(1);
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      await manager.start();
      const seen = recordStates(manager);

      await Promise.all([manager.stop(), manager.start()]);

      expect(seen).toEqual(["stopping", "stopped", "starting", "ready"]);
      expect(serverManager.startCalls).toBe(2);
    });

    it("start() on a configured URL only probes it", async () => {
      const serverManager = createMockServerManager(1);
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader,
        "http://10.0.0.99:1234"
      );

      await manager.start();

      expect(serverManager.startCalls).toBe(0);
      expect(manager.getState()).toEqual({
        status: "ready",
        url: "http://10.0.0.99:1234",
      });
    });

    it("fails the start when the process exits before ready", async () => {
      const serverManager = createMockServerManager(1);
      serverManager.start = async () => {
        serverManager.startCalls++;
        serverManager.running = true;
        serverManager.triggerStop();
      };
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );

      await expect(manager.start()).rejects.toThrow("exited while starting");
      expect(manager.getState()).toMatchObject({ status: "failed" });
    });

    it("does not reach ready when disposed while starting", async () => {
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        createMockServerManager(30),
        stubFileReader
      );

      const started = manager.start();
      await delay(5);
      await manager.dispose();

      await expect(started).rejects.toThrow("stopped while starting");
      expect(manager.getState()).toEqual({ status: "stopped" });
    });

    it("settles when the server dies while recreating notebooks", async () => {
      serveLocalNotebooks();
      const serverManager = createMockServerManager(1);
      let dieOnConnect = false;
      jest.spyOn(Host.prototype, "worker").mockImplementation(() =>
        createFakeWorker({
          notebook_id: NOTEBOOK_ID,
          connect: jest.fn(async () => {
            if (dieOnConnect) {
              dieOnConnect = false;
              serverManager.triggerStop();
            }
            return true;
          }),
        } as Partial<Worker>)
      );
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      await manager.getWorker("/tmp/one.pluto.jl");
      await manager.getWorker("/tmp/two.pluto.jl");
      await manager.stop();
      const recreated: string[] = [];
      manager.on("workerRecreated", (path) => recreated.push(path));

      dieOnConnect = true;
      await manager.start();
      expect(manager.getState().status).toBe("failed");
      expect(recreated).toEqual([]);

      await manager.start();
      expect(manager.getState().status).toBe("ready");
      expect(recreated.sort()).toEqual([
        "/tmp/one.pluto.jl",
        "/tmp/two.pluto.jl",
      ]);
    });

    describe("recreates open notebooks on every path to ready", () => {
      const paths: Array<
        [string, (m: PlutoManager, s: MockServerManager) => Promise<void>]
      > = [
        [
          "stop() then start()",
          async (m) => {
            await m.stop();
            await m.start();
          },
        ],
        [
          "restart()",
          async (m) => {
            await m.restart();
          },
        ],
        [
          "unexpected exit then start()",
          async (m, s) => {
            s.triggerStop();
            await m.start();
          },
        ],
        [
          "stop() then connect()",
          async (m) => {
            await m.stop();
            await m.connect();
          },
        ],
        [
          "stop() that leaves the process running, then start()",
          async (m, s) => {
            s.stop = async () => {};
            await m.stop();
            await m.start();
          },
        ],
      ];

      it.each(paths)("%s", async (_name, reachReadyAgain) => {
        serveLocalNotebooks();
        const serverManager = createMockServerManager(1);
        const manager = new PlutoManager(
          1234,
          createMockLogger(),
          serverManager,
          stubFileReader
        );
        await manager.getWorker(NOTEBOOK);
        const recreated: string[] = [];
        manager.on("workerRecreated", (path) => recreated.push(path));

        await reachReadyAgain(manager, serverManager);

        expect(manager.getState().status).toBe("ready");
        expect(recreated).toEqual([NOTEBOOK]);
        expect(manager.getOpenNotebooks()).toHaveLength(1);
      });
    });
  });
});
