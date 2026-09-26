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

describe("PlutoManager.getWorker", () => {
  const NOTEBOOK_ID = "5e2f7c1a-0c4b-4c7e-9a51-1f3d2b6a8c90";
  const NOTEBOOK = "/tmp/total.pluto.jl";
  const realFetch = global.fetch;
  let fetchMock: jest.Mock<(url: unknown) => Promise<unknown>>;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({
      ok: true,
      text: async () => NOTEBOOK_ID,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  const opensByPath = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/open"));

  function localManager(): PlutoManager {
    return new PlutoManager(
      1234,
      createMockLogger(),
      createMockServerManager(1),
      stubFileReader
    );
  }

  it("refuses to open a notebook when the running-notebooks listing times out", async () => {
    jest
      .spyOn(Host.prototype, "workers")
      .mockImplementation(() => new Promise(() => {}));
    const attach = jest.spyOn(Host.prototype, "worker");
    const manager = localManager();
    await manager.start();

    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    try {
      const opening = manager.getWorker(NOTEBOOK);
      const refused = expect(opening).rejects.toThrow(
        `Could not list the notebooks running on the Pluto server at http://localhost:1234 (Listing running notebooks timed out), so ${NOTEBOOK} was not opened`
      );
      await jest.advanceTimersByTimeAsync(30_000);
      await refused;
    } finally {
      jest.useRealTimers();
    }
    expect(opensByPath()).toEqual([]);
    expect(attach).not.toHaveBeenCalled();
    expect(manager.getOpenNotebooks()).toEqual([]);
  });

  it("adopts a notebook already running for the path, and only disconnects on close", async () => {
    jest
      .spyOn(Host.prototype, "workers")
      .mockResolvedValue([
        { notebook_id: NOTEBOOK_ID, path: NOTEBOOK },
      ] as never);
    const running = createFakeWorker({ notebook_id: NOTEBOOK_ID });
    jest.spyOn(Host.prototype, "worker").mockReturnValue(running);
    const manager = localManager();

    await expect(manager.getWorker(NOTEBOOK)).resolves.toBe(running);
    expect(opensByPath()).toEqual([]);

    await manager.closeNotebook(NOTEBOOK);
    expect(running.shutdown).not.toHaveBeenCalled();
  });

  it("opens by path, and owns, a notebook that is not running", async () => {
    jest.spyOn(Host.prototype, "workers").mockResolvedValue([]);
    const opened = createFakeWorker({ notebook_id: NOTEBOOK_ID });
    jest.spyOn(Host.prototype, "worker").mockReturnValue(opened);
    const manager = localManager();

    await expect(manager.getWorker(NOTEBOOK)).resolves.toBe(opened);
    expect(opensByPath()).toHaveLength(1);

    await manager.closeNotebook(NOTEBOOK);
    expect(opened.shutdown).toHaveBeenCalled();
  });

  it("rejects, never resolving without a worker, when the server exits while starting", async () => {
    jest.spyOn(Host.prototype, "workers").mockResolvedValue([]);
    const attach = jest
      .spyOn(Host.prototype, "worker")
      .mockReturnValue(createFakeWorker({ notebook_id: NOTEBOOK_ID }));
    const serverManager = createMockServerManager(1);
    const manager = new PlutoManager(
      1234,
      createMockLogger(),
      serverManager,
      stubFileReader
    );
    manager.on("serverStateChanged", (state) => {
      if (state.status === "ready") {
        serverManager.triggerStop();
      }
    });

    await expect(manager.getWorker(NOTEBOOK)).rejects.toThrow(
      "Pluto server stopped unexpectedly"
    );
    expect(attach).not.toHaveBeenCalled();
    expect(manager.getOpenNotebooks()).toEqual([]);
  });

  it("reopens a notebook whose cached connection is gone, telling listeners", async () => {
    jest.spyOn(Host.prototype, "workers").mockResolvedValue([]);
    const first = createFakeWorker({
      notebook_id: NOTEBOOK_ID,
      close: jest.fn(),
    } as Partial<Worker>);
    const second = createFakeWorker({ notebook_id: NOTEBOOK_ID });
    jest
      .spyOn(Host.prototype, "worker")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const manager = localManager();
    await manager.getWorker(NOTEBOOK);
    const recreated: Worker[] = [];
    manager.on("workerRecreated", (_path, worker) => recreated.push(worker));

    Object.assign(first, {
      connected: false,
      connect: jest.fn(async () => false),
    });
    await expect(manager.getWorker(NOTEBOOK)).resolves.toBe(second);
    expect(first.close).toHaveBeenCalled();
    expect(recreated).toEqual([second]);
  });

  describe("ownership of a notebook reopened after its connection dropped", () => {
    const OTHER_ID = "9a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
    const running = (id: string) => [{ notebook_id: id, path: NOTEBOOK }];

    function dropConnection(worker: Worker): void {
      Object.assign(worker, {
        connected: false,
        connect: jest.fn(async () => false),
      });
    }

    async function reopenAfterDrop(options: {
      listedBefore: Array<{ notebook_id: string; path: string }>;
      listedAfter: Array<{ notebook_id: string; path: string }>;
      reopenedId: string;
    }): Promise<{ manager: PlutoManager; reopened: Worker }> {
      jest
        .spyOn(Host.prototype, "workers")
        .mockResolvedValueOnce(options.listedBefore as never)
        .mockResolvedValueOnce(options.listedAfter as never);
      const first = createFakeWorker({
        notebook_id: NOTEBOOK_ID,
        close: jest.fn(),
      } as Partial<Worker>);
      const reopened = createFakeWorker({ notebook_id: options.reopenedId });
      jest
        .spyOn(Host.prototype, "worker")
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(reopened);
      const manager = localManager();
      await manager.getWorker(NOTEBOOK);
      dropConnection(first);

      await expect(manager.getWorker(NOTEBOOK)).resolves.toBe(reopened);
      expect(first.close).toHaveBeenCalled();
      return { manager, reopened };
    }

    it("keeps an owned notebook that kept running owned", async () => {
      const { manager, reopened } = await reopenAfterDrop({
        listedBefore: [],
        listedAfter: running(NOTEBOOK_ID),
        reopenedId: NOTEBOOK_ID,
      });

      await manager.closeNotebook(NOTEBOOK);
      expect(reopened.shutdown).toHaveBeenCalled();
    });

    it("owns the new session of an adopted notebook that was shut down", async () => {
      const { manager, reopened } = await reopenAfterDrop({
        listedBefore: running(NOTEBOOK_ID),
        listedAfter: [],
        reopenedId: OTHER_ID,
      });
      expect(opensByPath()).toHaveLength(1);

      await manager.closeNotebook(NOTEBOOK);
      expect(reopened.shutdown).toHaveBeenCalled();
    });

    it("keeps an adopted notebook reconnected to the same session adopted", async () => {
      const { manager, reopened } = await reopenAfterDrop({
        listedBefore: running(NOTEBOOK_ID),
        listedAfter: running(NOTEBOOK_ID),
        reopenedId: NOTEBOOK_ID,
      });

      await manager.closeNotebook(NOTEBOOK);
      expect(reopened.shutdown).not.toHaveBeenCalled();
    });
  });

  it("never starts the server for a notebook operation", async () => {
    const serverManager = createMockServerManager(1);
    const manager = new PlutoManager(
      1234,
      createMockLogger(),
      serverManager,
      stubFileReader
    );

    await expect(manager.deleteCell(NOTEBOOK, "c1")).rejects.toThrow(
      `Pluto server is not running, so ${NOTEBOOK} is not available; start the Pluto server first.`
    );
    expect(serverManager.startCalls).toBe(0);
  });

  it("runs executeCell on one worker, without starting a server stopped mid-run", async () => {
    jest.spyOn(Host.prototype, "workers").mockResolvedValue([]);
    let lastRun = 0;
    const cells: Record<string, { code: string; code_folded: boolean }> = {
      c1: { code: "x = 1", code_folded: false },
    };
    const serverManager = createMockServerManager(1);
    const manager = new PlutoManager(
      1234,
      createMockLogger(),
      serverManager,
      stubFileReader
    );
    const worker = createFakeWorker({
      notebook_id: NOTEBOOK_ID,
      notebook_state: { cell_inputs: cells },
      client: {
        send: jest.fn(async () => {
          lastRun = 1;
        }),
      },
      _update_notebook_state: async (
        mutate: (nb: { cell_inputs: typeof cells }) => void
      ) => {
        mutate({ cell_inputs: cells });
        await manager.stop();
      },
      getSnippet: () => ({
        result: {
          running: false,
          queued: false,
          output: { last_run_timestamp: lastRun },
        },
      }),
    } as unknown as Partial<Worker>);
    jest.spyOn(Host.prototype, "worker").mockReturnValue(worker);
    await manager.start();
    const lookups = jest.spyOn(manager, "liveWorker");

    await manager.executeCell(NOTEBOOK, "c1", "x = 2");

    expect(cells.c1.code).toBe("x = 2");
    expect(lookups).toHaveBeenCalledTimes(1);
    expect(serverManager.startCalls).toBe(1);
    expect(manager.getState().status).toBe("stopped");
  });

  it("addresses cell operations by path", async () => {
    jest.spyOn(Host.prototype, "workers").mockResolvedValue([]);
    const deleteSnippets = jest.fn(async () => undefined);
    const moveSnippets = jest.fn(async () => undefined);
    jest.spyOn(Host.prototype, "worker").mockReturnValue(
      createFakeWorker({
        notebook_id: NOTEBOOK_ID,
        deleteSnippets,
        moveSnippets,
      } as Partial<Worker>)
    );
    const manager = localManager();

    await manager.start();
    await manager.deleteCell(NOTEBOOK, "c1");
    await manager.moveCells(NOTEBOOK, ["c2"], 0);

    expect(deleteSnippets).toHaveBeenCalledWith(["c1"]);
    expect(moveSnippets).toHaveBeenCalledWith(["c2"], 0);
    expect(opensByPath()).toHaveLength(1);
  });
});
