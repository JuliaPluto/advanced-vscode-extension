import { jest } from "@jest/globals";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createPlutoTools } from "../mcpTools/index.js";
import { EXECUTION_TIMEOUT_MS } from "../mcpTools/tool.js";
import {
  SERVER_URL,
  fakePlutoManager,
  fakeWorker,
  textOf,
} from "./helpers/fakePlutoManager.js";
import { serverCapabilities } from "../serverCapabilities.js";

const json = (result: { content: unknown }) => JSON.parse(textOf(result));

describe("the tool set", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pluto-tools-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses notebook tools on a stopped server without opening anything", async () => {
    const manager = fakePlutoManager({ state: { status: "stopped" } });
    const result = await createPlutoTools(manager).call("list_cells", {
      path: "/nb.jl",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("start_pluto_server");
    expect(manager.getWorker).not.toHaveBeenCalled();
    expect(manager.start).not.toHaveBeenCalled();
  });

  it("runs edit_cell by default", async () => {
    const manager = fakePlutoManager();
    const tools = createPlutoTools(manager);
    await tools.call("edit_cell", { path: "/nb.jl", cell_id: "c1", code: "y" });
    expect(manager.executeCell).toHaveBeenCalledWith("/nb.jl", "c1", "y");
    const result = await tools.call("edit_cell", {
      path: "/nb.jl",
      cell_id: "c1",
      code: "z",
      run: false,
    });
    expect(manager.setCellCode).toHaveBeenCalledWith("/nb.jl", "c1", "z");
    expect(json(result).message).toContain("not executed");
  });

  it("lists cells", async () => {
    const result = await createPlutoTools(fakePlutoManager()).call(
      "list_cells",
      { path: "/nb.jl" }
    );
    expect(json(result)).toEqual({
      count: 1,
      cells: [
        {
          cell_id: "c1",
          index: 0,
          code_preview: "x = 1",
          code_folded: false,
          errored: false,
          running: false,
          queued: false,
        },
      ],
    });
  });

  it("reports a missing cell from read_cell without an error", async () => {
    const result = await createPlutoTools(fakePlutoManager()).call(
      "read_cell",
      { path: "/nb.jl", cell_id: "nope" }
    );
    expect(result.isError).toBeUndefined();
    expect(json(result)).toEqual({ error: "Cell nope not found" });
  });

  it("reads a cell's full text output", async () => {
    const result = await createPlutoTools(fakePlutoManager()).call(
      "read_cell_output",
      { path: "/nb.jl", cell_id: "c1" }
    );
    expect(json(result)).toEqual({
      cell_id: "c1",
      mime: "text/plain",
      bytes: 1,
      encoding: "utf-8",
      body: "1",
    });
  });

  it("returns a raster output as an image block", async () => {
    const worker = fakeWorker([
      {
        cell_id: "c1",
        code: "plot()",
        output: { mime: "image/png", body: new Uint8Array([1, 2, 3]) },
      },
    ]);
    const result = await createPlutoTools(fakePlutoManager({ worker })).call(
      "read_cell_output",
      { path: "/nb.jl", cell_id: "c1", as: "image" }
    );
    expect(result.content).toEqual([
      { type: "image", data: "AQID", mimeType: "image/png" },
      { type: "text", text: "image/png, 3 bytes" },
    ]);
  });

  it("saves the notebook Pluto holds to output_path", async () => {
    const out = join(dir, "copy.pluto.jl");
    const result = await createPlutoTools(fakePlutoManager()).call(
      "save_notebook",
      { path: "/nb.jl", output_path: out }
    );
    expect(textOf(result)).toBe(`Notebook saved to ${out} (28 bytes)`);
    expect(await readFile(out, "utf-8")).toBe("### A Pluto.jl notebook ###\n");
  });

  it("creates a notebook file and opens it, refusing an existing one", async () => {
    const manager = fakePlutoManager();
    const tools = createPlutoTools(manager);
    const file = join(dir, "sub", "new.pluto.jl");
    const created = await tools.call("create_notebook", {
      path: file,
      title: "T",
    });
    expect(textOf(created)).toContain(`Notebook created and opened: ${file}`);
    expect(await readFile(file, "utf-8")).toContain(
      "### A Pluto.jl notebook ###"
    );
    expect(manager.getWorker).toHaveBeenCalledWith(file);

    const again = await tools.call("create_notebook", { path: file });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain("already exists");
  });

  it("refuses a relative notebook path before writing anything", async () => {
    const manager = fakePlutoManager();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await createPlutoTools(manager).call("create_notebook", {
        path: "rel/new.pluto.jl",
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("must be absolute");
      expect(existsSync(join(dir, "rel"))).toBe(false);
      expect(manager.getWorker).not.toHaveBeenCalled();
    } finally {
      process.chdir(cwd);
    }
  });

  it("moves cells and folds a cell through the manager", async () => {
    const manager = fakePlutoManager();
    const tools = createPlutoTools(manager);
    const moved = await tools.call("move_cells", {
      path: "/nb.jl",
      cell_ids: ["c1"],
      index: 0,
    });
    expect(textOf(moved)).toBe("Moved 1 cell(s) to position 0");
    expect(manager.moveCells).toHaveBeenCalledWith("/nb.jl", ["c1"], 0);

    const folded = await tools.call("fold_cell", {
      path: "/nb.jl",
      cell_id: "c1",
      folded: true,
    });
    expect(textOf(folded)).toBe("Cell c1 folded (code hidden)");
  });

  it("refuses move_notebook on a remote server before opening the notebook", async () => {
    const manager = fakePlutoManager({
      overrides: {
        capabilities: () =>
          serverCapabilities({
            sharesFilesystem: false,
            writesNotebookFiles: true,
          }),
      },
    });
    const result = await createPlutoTools(manager).call("move_notebook", {
      path: "/nb.jl",
      new_path: "/moved.jl",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "Moving a notebook only works when the Pluto server is on localhost (it shares this machine's filesystem). Use save_notebook to write a copy instead."
    );
    expect(manager.getWorker).not.toHaveBeenCalled();
    expect(manager.moveNotebook).not.toHaveBeenCalled();
  });

  it("refuses to render a non-raster output to PNG on a remote server", async () => {
    const worker = fakeWorker([
      {
        cell_id: "c1",
        code: "plot()",
        output: { mime: "image/svg+xml", body: "<svg/>" },
      },
    ]);
    const manager = fakePlutoManager({
      worker,
      overrides: {
        capabilities: () =>
          serverCapabilities({
            sharesFilesystem: false,
            writesNotebookFiles: true,
          }),
      },
    });
    const result = await createPlutoTools(manager).call("read_cell_output", {
      path: "/nb.jl",
      cell_id: "c1",
      as: "image",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "The cell's output is image/svg+xml. Rendering to a file needs a Pluto server on localhost (it shares this machine's filesystem). Use as: \"file\" with a .svg name to save the original output instead."
    );
    expect(manager.executeCodeEphemeral).not.toHaveBeenCalled();
  });

  it.each([
    [
      true,
      true,
      "Pluto is tracking this file path and will save changes to it.",
    ],
    [
      true,
      false,
      "The server does not write this file: changes reach disk when the notebook is saved in the editor, or through save_notebook.",
    ],
    [
      false,
      true,
      "Warning: Pluto server is remote — the file on disk is NOT synced with the server. Use save_notebook to write changes back to the local file.",
    ],
  ])(
    "open_notebook reports who keeps the file (shared filesystem %s, server writes %s)",
    async (sharesFilesystem, writesNotebookFiles, note) => {
      const manager = fakePlutoManager({
        overrides: {
          capabilities: () =>
            serverCapabilities({ sharesFilesystem, writesNotebookFiles }),
        },
      });
      const result = await createPlutoTools(manager).call("open_notebook", {
        path: "/nb.jl",
      });
      expect(textOf(result).split("\n").at(-1)).toBe(note);
    }
  );

  it("exports HTML next to the notebook by default", async () => {
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html></html>"));
    try {
      const notebook = join(dir, "nb.pluto.jl");
      const result = await createPlutoTools(fakePlutoManager()).call(
        "export_notebook_html",
        { path: notebook }
      );
      const html = join(dir, "nb.html");
      expect(textOf(result)).toBe(`Notebook exported to ${html} (13 bytes)`);
      expect(await readFile(html, "utf-8")).toBe("<html></html>");
      expect(fetch).toHaveBeenCalledWith(
        `${SERVER_URL}/notebookexport?id=nb-1`,
        expect.anything()
      );
    } finally {
      fetch.mockRestore();
    }
  });

  it("does not write a rendered file after read_cell_output timed out", async () => {
    let finishRender = () => {};
    const rendered = new Promise<void>((resolve) => (finishRender = resolve));
    const worker = fakeWorker([
      {
        cell_id: "c1",
        code: "plot()",
        output: { mime: "image/svg+xml", body: "<svg/>" },
      },
    ]);
    const manager = fakePlutoManager({
      worker,
      overrides: {
        executeCodeEphemeral: async (_worker, code) => {
          await rendered;
          const png = /"([^"]+\.png)", "w"/.exec(code)![1];
          await writeFile(png, new Uint8Array([1]));
          return {
            errored: false,
            output: { mime: "text/plain", body: "1" },
          } as never;
        },
      },
    });
    const dest = join(dir, "plot.png");
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    try {
      const call = createPlutoTools(manager).call("read_cell_output", {
        path: "/nb.jl",
        cell_id: "c1",
        as: "file",
        output_path: dest,
      });
      await jest.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS);
      expect(JSON.parse(textOf(await call)).message).toContain(
        "nothing was written"
      );
    } finally {
      jest.useRealTimers();
    }
    finishRender();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(dest)).toBe(false);
  });

  it("gives the notebook's browser URL", async () => {
    const result = await createPlutoTools(fakePlutoManager()).call(
      "get_notebook_url",
      { path: "/nb.jl" }
    );
    expect(textOf(result)).toBe(`${SERVER_URL}/edit?id=nb-1`);
  });

  it("reports server state without a guard", async () => {
    const manager = fakePlutoManager({
      state: { status: "failed", url: SERVER_URL, reason: "no julia" },
    });
    const result = await createPlutoTools(manager).call("get_notebook_status");
    expect(json(result)).toMatchObject({
      server_running: false,
      server_state: "failed",
      failure_reason: "no julia",
    });
  });
});
