import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createPlutoTools } from "../mcpTools/index.js";
import {
  SERVER_URL,
  fakePlutoManager,
  fakeWorker,
  textOf,
} from "./helpers/fakePlutoManager.js";

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
    expect(manager.executeCell).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      "y"
    );
    const result = await tools.call("edit_cell", {
      path: "/nb.jl",
      cell_id: "c1",
      code: "z",
      run: false,
    });
    expect(manager.setCellCode).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      "z"
    );
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

  it("moves cells and folds a cell through the manager", async () => {
    const manager = fakePlutoManager();
    const tools = createPlutoTools(manager);
    const moved = await tools.call("move_cells", {
      path: "/nb.jl",
      cell_ids: ["c1"],
      index: 0,
    });
    expect(textOf(moved)).toBe("Moved 1 cell(s) to position 0");
    expect(manager.moveCells).toHaveBeenCalledWith(
      expect.anything(),
      ["c1"],
      0
    );

    const folded = await tools.call("fold_cell", {
      path: "/nb.jl",
      cell_id: "c1",
      folded: true,
    });
    expect(textOf(folded)).toBe("Cell c1 folded (code hidden)");
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
