import { jest } from "@jest/globals";
import { createServer, type Server } from "http";
import { createServer as createNetServer } from "net";
import type {
  LaunchSpec,
  LaunchedProcess,
  ProcessLauncher,
} from "../server/launcher.ts";
import { PlutoServer, type JuliaToolchain } from "../server/plutoServer.ts";
import { findAvailablePort } from "../portUtils.ts";

interface FakeBehaviour {
  /** Start answering HTTP after this long; never when undefined. */
  readyAfterMs?: number;
  /** Exit on its own after this long. */
  exitAfterMs?: number;
  ignoresGraceful?: boolean;
  /** Survive even "kill", exiting only when the test says so. */
  ignoresKill?: boolean;
}

/** A "server process" that is an in-process HTTP server on the port. */
class FakeProcess implements LaunchedProcess {
  readonly terminations: Array<"graceful" | "kill"> = [];
  private readonly listeners: Array<(code: number | undefined) => void> = [];
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private server?: Server;
  ended = false;

  constructor(
    readonly port: number,
    private readonly behaviour: FakeBehaviour
  ) {
    if (behaviour.readyAfterMs !== undefined) {
      this.timers.push(setTimeout(() => this.listen(), behaviour.readyAfterMs));
    }
    if (behaviour.exitAfterMs !== undefined) {
      this.timers.push(setTimeout(() => this.exit(1), behaviour.exitAfterMs));
    }
  }

  private listen(): void {
    this.server = createServer((_req, res) => res.end("pluto")).listen(
      this.port
    );
  }

  onExit(listener: (code: number | undefined) => void): void {
    if (this.ended) {
      listener(0);
    } else {
      this.listeners.push(listener);
    }
  }

  terminate(how: "graceful" | "kill"): void {
    this.terminations.push(how);
    const ignored =
      how === "kill"
        ? this.behaviour.ignoresKill
        : this.behaviour.ignoresGraceful || this.behaviour.ignoresKill;
    if (!ignored) {
      this.exit(0);
    }
  }

  exit(code: number): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.timers.forEach(clearTimeout);
    this.server?.close();
    this.server?.closeAllConnections();
    for (const listener of this.listeners) {
      listener(code);
    }
  }
}

class FakeLauncher implements ProcessLauncher {
  readonly launched: Array<{ spec: LaunchSpec; process: FakeProcess }> = [];
  adoptable?: FakeProcess;

  constructor(private readonly behaviour: FakeBehaviour = {}) {}

  async launch(spec: LaunchSpec): Promise<FakeProcess> {
    const process = new FakeProcess(spec.port, this.behaviour);
    this.launched.push({ spec, process });
    return process;
  }

  async adopt() {
    const process = this.adoptable;
    this.adoptable = undefined;
    return process && { process, port: process.port };
  }
}

const toolchain: JuliaToolchain = {
  command: "julia",
  args: ["+1.11"],
  packageServer: "https://pkg.example",
  workspaceDir: "/work",
};

const fast = {
  readiness: { timeoutMs: 400, intervalMs: 10 },
  stopTimeoutMs: 50,
};

describe("PlutoServer", () => {
  let port: number;
  let processes: FakeProcess[];
  let resolveToolchain: jest.Mock<() => Promise<JuliaToolchain>>;
  const warnings: string[] = [];
  const log = { warn: (message: string) => warnings.push(message) };

  function serverWith(launcher: FakeLauncher, overrides = {}) {
    return new PlutoServer(
      launcher,
      resolveToolchain,
      {
        port,
        writeNotebookFiles: false,
        update: true,
        ...fast,
        ...overrides,
      },
      log
    );
  }

  beforeEach(async () => {
    port = await findAvailablePort(20000 + Math.floor(Math.random() * 20000));
    processes = [];
    warnings.length = 0;
    resolveToolchain = jest.fn(async () => toolchain);
  });

  afterEach(() => {
    processes.forEach((p) => p.exit(0));
  });

  function track(launcher: FakeLauncher): FakeLauncher {
    const launch = launcher.launch.bind(launcher);
    launcher.launch = async (spec) => {
      const process = await launch(spec);
      processes.push(process);
      return process;
    };
    return launcher;
  }

  describe("port selection", () => {
    it("uses the preferred port when it is free", async () => {
      const launcher = track(new FakeLauncher({ readyAfterMs: 0 }));

      const url = await serverWith(launcher).start();

      expect(url).toBe(`http://localhost:${port}`);
      expect(launcher.launched[0].spec.port).toBe(port);
      expect(warnings).toEqual([]);
    });

    it("falls back to the next free port and says so", async () => {
      const blocker = createNetServer().listen(port, "127.0.0.1");
      await new Promise((r) => blocker.once("listening", r));
      try {
        const launcher = track(new FakeLauncher({ readyAfterMs: 0 }));

        const url = await serverWith(launcher).start();

        const used = launcher.launched[0].spec.port;
        expect(used).toBeGreaterThan(port);
        expect(url).toBe(`http://localhost:${used}`);
        expect(warnings).toEqual([
          `Port ${port} is in use. Starting Pluto server on port ${used} instead.`,
        ]);
      } finally {
        blocker.close();
      }
    });
  });

  describe("launch", () => {
    it("runs the bootstrap program with the assembled environment", async () => {
      const launcher = track(new FakeLauncher({ readyAfterMs: 0 }));

      await serverWith(launcher).start();

      const { spec } = launcher.launched[0];
      expect(spec.command).toBe("julia");
      expect(spec.args.slice(0, 2)).toEqual(["+1.11", "-e"]);
      expect(spec.args[2]).toContain(`Pluto.run(port=${port};`);
      expect(spec.args[2]).toContain("disable_writing_notebook_files=true");
      expect(spec.env).toMatchObject({
        JULIA_PKG_SERVER: "https://pkg.example",
        JULIA_PLUTO_VSCODE_WORKSPACE: "/work",
      });
      expect(spec.env.JULIA_DEPOT_PATH).toBeTruthy();
    });

    it("passes the load path, token, host extras and workspace through", async () => {
      resolveToolchain.mockResolvedValue({
        ...toolchain,
        juliaHubToken: "secret",
        env: { JULIAUP_SERVER: "https://juliaup.example" },
      });
      const launcher = track(new FakeLauncher({ readyAfterMs: 0 }));

      await serverWith(launcher).start();

      expect(launcher.launched[0].spec.env).toMatchObject({
        JULIA_LOAD_PATH: process.platform === "win32" ? ";" : ":",
        JULIAHUB_TOKEN: "secret",
        JULIAUP_SERVER: "https://juliaup.example",
        JULIA_PLUTO_VSCODE_WORKSPACE: "/work",
      });
    });

    it("sets an empty workspace but leaves an absent one unset", async () => {
      const envFor = async (workspaceDir: string | undefined) => {
        resolveToolchain.mockResolvedValue({ ...toolchain, workspaceDir });
        const launcher = track(new FakeLauncher({ readyAfterMs: 0 }));
        const server = serverWith(launcher);
        await server.start();
        await server.stop();
        return launcher.launched[0].spec.env;
      };

      expect((await envFor("")).JULIA_PLUTO_VSCODE_WORKSPACE).toBe("");
      expect(await envFor(undefined)).not.toHaveProperty(
        "JULIA_PLUTO_VSCODE_WORKSPACE"
      );
    });

    it("answers writesNotebookFiles from the same option", () => {
      expect(
        serverWith(new FakeLauncher(), { writeNotebookFiles: true })
          .writesNotebookFiles
      ).toBe(true);
      expect(serverWith(new FakeLauncher()).writesNotebookFiles).toBe(false);
    });
  });

  describe("readiness", () => {
    it("resolves only once the server answers", async () => {
      const launcher = track(new FakeLauncher({ readyAfterMs: 80 }));
      const started = Date.now();

      await serverWith(launcher).start();

      expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    });

    it("fails fast when the process exits before it is ready", async () => {
      const launcher = track(new FakeLauncher({ exitAfterMs: 20 }));
      const started = Date.now();

      await expect(serverWith(launcher).start()).rejects.toThrow(
        "exited before it was ready"
      );
      expect(Date.now() - started).toBeLessThan(fast.readiness.timeoutMs);
    });

    it("gives up after the budget and terminates the process", async () => {
      const launcher = track(new FakeLauncher());

      await expect(serverWith(launcher).start()).rejects.toThrow(
        "did not start within"
      );
      expect(launcher.launched[0].process.terminations).toEqual(["graceful"]);
    });

    it("cancels a start and terminates the process", async () => {
      const launcher = track(new FakeLauncher());
      const controller = new AbortController();

      const started = serverWith(launcher).start(controller.signal);
      setTimeout(() => controller.abort(), 30);

      await expect(started).rejects.toThrow();
      expect(launcher.launched[0].process.ended).toBe(true);
    });

    it("shares one start between concurrent callers and returns the URL while running", async () => {
      const launcher = track(new FakeLauncher({ readyAfterMs: 20 }));
      const server = serverWith(launcher);

      const [a, b] = await Promise.all([server.start(), server.start()]);
      const c = await server.start();

      expect(new Set([a, b, c]).size).toBe(1);
      expect(launcher.launched).toHaveLength(1);
    });
  });

  describe("adoption", () => {
    it("waits for an adopted server on the full readiness budget", async () => {
      const launcher = track(new FakeLauncher({ readyAfterMs: 0 }));
      const adoptedPort = await findAvailablePort(port + 1);
      // Much longer than one probe: an adopted server still booting is waited for
      const adopted = new FakeProcess(adoptedPort, { readyAfterMs: 150 });
      processes.push(adopted);
      launcher.adoptable = adopted;

      const url = await serverWith(launcher).start();

      expect(url).toBe(`http://localhost:${adoptedPort}`);
      expect(launcher.launched).toHaveLength(0);
      expect(resolveToolchain).not.toHaveBeenCalled();
    });

    it("fails an adopted server that never answers like a launched one", async () => {
      const launcher = track(new FakeLauncher());
      const adopted = new FakeProcess(port, {});
      processes.push(adopted);
      launcher.adoptable = adopted;

      await expect(serverWith(launcher).start()).rejects.toThrow(
        "did not start within 0.4 seconds"
      );
      expect(adopted.terminations).toEqual(["graceful"]);
    });

    it("stops an adopted server like a launched one", async () => {
      const launcher = track(new FakeLauncher());
      const adopted = new FakeProcess(port, { readyAfterMs: 0 });
      processes.push(adopted);
      launcher.adoptable = adopted;
      const server = serverWith(launcher);
      await server.start();

      await server.stop();

      expect(adopted.terminations).toEqual(["graceful"]);
      expect(adopted.ended).toBe(true);
    });
  });

  describe("stop", () => {
    it("kills a process that ignores the graceful request after the budget, without reporting its exit", async () => {
      const launcher = track(
        new FakeLauncher({ readyAfterMs: 0, ignoresGraceful: true })
      );
      const server = serverWith(launcher);
      const onExit = jest.fn();
      server.onExit(onExit);
      await server.start();
      const started = Date.now();

      await server.stop();

      const { process } = launcher.launched[0];
      expect(Date.now() - started).toBeGreaterThanOrEqual(
        fast.stopTimeoutMs - 5
      );
      expect(process.terminations).toEqual(["graceful", "kill"]);
      expect(onExit).not.toHaveBeenCalled();
    });

    it("does not let a late exit of a stopped process touch the next one", async () => {
      const launcher = track(
        new FakeLauncher({ readyAfterMs: 0, ignoresKill: true })
      );
      const server = serverWith(launcher);
      const onExit = jest.fn();
      server.onExit(onExit);
      await server.start();
      await server.stop();
      const next = await server.start();

      launcher.launched[0].process.exit(9);

      expect(onExit).not.toHaveBeenCalled();
      expect(await server.start()).toBe(next);
      expect(launcher.launched).toHaveLength(2);
      launcher.launched[1].process.exit(1);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when nothing runs", async () => {
      await expect(
        serverWith(new FakeLauncher()).stop()
      ).resolves.toBeUndefined();
    });

    it("reports an exit it did not ask for, once, and launches again on the next start", async () => {
      const launcher = track(new FakeLauncher({ readyAfterMs: 0 }));
      const server = serverWith(launcher);
      const onExit = jest.fn();
      server.onExit(onExit);
      await server.start();

      launcher.launched[0].process.exit(1);
      await server.start();

      expect(onExit).toHaveBeenCalledTimes(1);
      expect(launcher.launched).toHaveLength(2);
    });
  });
});
