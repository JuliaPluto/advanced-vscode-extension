import { jest } from "@jest/globals";
import {
  PlutoManager,
  PlutoManagerLogger,
  type ServerState,
} from "../plutoManager.js";
import type { IPlutoServer, IFileReader } from "../plutoManagerTypes.js";
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

const SERVER_URL = "http://localhost:1234";

interface MockServerManager extends IPlutoServer {
  startCalls: number;
  running: boolean;
  /** An exit the server did not ask for */
  triggerStop: () => void;
}

function createMockServerManager(startDelayMs = 20): MockServerManager {
  let onExitCallback: (() => void) | undefined;
  const manager: MockServerManager = {
    startCalls: 0,
    running: false,
    writesNotebookFiles: true,
    triggerStop: () => {
      manager.running = false;
      onExitCallback?.();
    },
    start: async () => {
      manager.startCalls++;
      if (!manager.running) {
        await delay(startDelayMs);
        manager.running = true;
      }
      return SERVER_URL;
    },
    stop: async () => {
      manager.running = false;
    },
    onExit: (cb: () => void) => {
      onExitCallback = cb;
    },
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
        return SERVER_URL;
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

  describe("capabilities()", () => {
    function managerFor(serverUrl: string | undefined, ownedWrites: boolean) {
      const server = createMockServerManager(1);
      Object.assign(server, { writesNotebookFiles: ownedWrites });
      return new PlutoManager(
        1234,
        createMockLogger(),
        server,
        stubFileReader,
        serverUrl
      );
    }

    it("leaves the file to the editor for a server it started that does not write it", async () => {
      const manager = managerFor(undefined, false);
      await manager.start();
      expect(manager.capabilities().fileSync).toBe("editor-writes-file");
    });

    it("assumes a server reached through connect() writes files, even on the default URL", async () => {
      const manager = managerFor(undefined, false);
      await manager.connect();
      expect(manager.capabilities().fileSync).toBe("server-writes-file");
    });

    it("forgets ownership when a later connect() replaces a started server", async () => {
      const manager = managerFor(undefined, false);
      await manager.start();
      await manager.stop();
      await manager.connect();
      expect(manager.capabilities().fileSync).toBe("server-writes-file");
    });

    it("assumes a local server it did not start writes files, whatever the owned one would do", () => {
      expect(
        managerFor("http://127.0.0.1:1300", false).capabilities().fileSync
      ).toBe("server-writes-file");
    });

    it("treats a remote server as holding a copy", () => {
      const caps = managerFor("http://10.0.0.99:1234", false).capabilities();
      expect(caps.fileSync).toBe("server-holds-copy");
      expect(caps.moveNotebook.ok).toBe(false);
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

    it("takes an owned server's URL from its start, and forgets it on stop", async () => {
      const serverManager = createMockServerManager(1);
      serverManager.start = async () => "http://localhost:1235";
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      const urls: string[] = [];
      manager.on("serverStateChanged", (state) => {
        if (state.status !== "stopped") {
          urls.push(state.url);
        }
      });

      await manager.start();
      expect(manager.getServerUrl()).toBe("http://localhost:1235");
      await manager.stop();

      expect(urls).toEqual([
        "http://localhost:1234",
        "http://localhost:1235",
        "http://localhost:1235",
      ]);
      expect(manager.getServerUrl()).toBe("http://localhost:1234");
    });

    it("returns to the configured URL when an owned server on a fallback port dies", async () => {
      const serverManager = createMockServerManager(1);
      serverManager.start = async () => {
        serverManager.running = true;
        return "http://localhost:1235";
      };
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      await manager.start();
      expect(manager.getServerUrl()).toBe("http://localhost:1235");

      serverManager.triggerStop();

      expect(manager.getState()).toMatchObject({
        status: "failed",
        url: "http://localhost:1235",
      });
      expect(manager.getServerUrl()).toBe("http://localhost:1234");
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

    it("cancelStart() aborts the launch and returns to stopped", async () => {
      const serverManager = createMockServerManager(1);
      let launchSignal: AbortSignal | undefined;
      serverManager.start = (signal) => {
        launchSignal = signal;
        return new Promise<string>((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason))
        );
      };
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );
      const seen = recordStates(manager);

      const started = manager.start();
      await delay(5);
      expect(manager.cancelStart()).toBe(true);

      await expect(started).rejects.toThrow("cancelled");
      expect(launchSignal?.aborted).toBe(true);
      expect(seen).toEqual(["starting", "stopped"]);
      expect(manager.cancelStart()).toBe(false);
    });

    it("cancelStart() stops a launch that ignores the signal", async () => {
      const serverManager = createMockServerManager(20);
      const stop = jest.spyOn(serverManager, "stop");
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );

      const started = manager.start();
      await delay(5);
      manager.cancelStart();

      await expect(started).rejects.toThrow("cancelled");
      expect(stop).toHaveBeenCalled();
      expect(serverManager.running).toBe(false);
      expect(manager.getState()).toEqual({ status: "stopped" });
    });

    it("cancelStart() ends stopped even when stopping the launch fails", async () => {
      const serverManager = createMockServerManager(20);
      serverManager.stop = async () => {
        throw new Error("terminate failed");
      };
      const manager = new PlutoManager(
        1234,
        createMockLogger(),
        serverManager,
        stubFileReader
      );

      const started = manager.start();
      await delay(5);
      manager.cancelStart();

      await expect(started).rejects.toThrow("terminate failed");
      expect(manager.getState()).toEqual({ status: "stopped" });
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
        return SERVER_URL;
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
      await expect(manager.start()).rejects.toThrow("stopped unexpectedly");
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
