import { jest } from "@jest/globals";
import { PlutoManager, PlutoManagerLogger } from "../plutoManager.js";
import type { IPlutoServerManager, IFileReader } from "../plutoManagerTypes.js";
import { Host, Worker } from "@plutojl/rainbow";

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
      await delay(startDelayMs);
      manager.running = true;
    },
    stop: async () => {
      // Like real managers, the process exit fires the stop callback
      // before stop() resolves
      manager.triggerStop();
    },
    isRunning: () => manager.running,
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
    connect: jest.fn(async () => undefined),
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
});
