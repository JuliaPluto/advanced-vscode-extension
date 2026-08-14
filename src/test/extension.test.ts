import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const EXTENSION_ID = "juliapluto-pankgeorg.advanced-vscode-extension";

suite("Extension Test Suite", () => {
  test("extension is present and activates", async function (this: Mocha.Context) {
    this.timeout(60_000);
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} not found`);
    await extension.activate();
    assert.ok(extension.isActive, "extension failed to activate");
  });

  test("commands are registered", async function (this: Mocha.Context) {
    this.timeout(60_000);
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "pluto-notebook.startServer",
      "pluto-notebook.stopServer",
      "pluto-notebook.restartServer",
      "pluto-notebook.toggleServer",
      "pluto-notebook.openInBrowser",
      "pluto-notebook.createNewNotebook",
      "pluto-notebook.createTerminal",
      "pluto-notebook.refreshNotebooks",
      "pluto-notebook.toggleView",
    ]) {
      assert.ok(commands.includes(command), `command missing: ${command}`);
    }
  });

  test("a .pluto.jl file opens as a Pluto notebook with parsed cells", async function (this: Mocha.Context) {
    this.timeout(60_000);
    const cellId = "00112233-4455-6677-8899-aabbccddeeff";
    const notebookSource = [
      "### A Pluto.jl notebook ###",
      "# v0.20.21",
      "",
      "using Markdown",
      "using InteractiveUtils",
      "",
      `# ╔═╡ ${cellId}`,
      "x = 1 + 1",
      "",
      "# ╔═╡ Cell order:",
      `# ╠═${cellId}`,
      "",
    ].join("\n");

    const filePath = path.join(
      os.tmpdir(),
      `extension-test-${process.pid}-${Math.random().toString(36).slice(2)}.pluto.jl`
    );
    fs.writeFileSync(filePath, notebookSource);

    try {
      const document = await vscode.workspace.openNotebookDocument(
        vscode.Uri.file(filePath)
      );

      assert.strictEqual(document.notebookType, "pluto-notebook");
      assert.strictEqual(document.cellCount, 1);

      const cell = document.getCells()[0];
      assert.strictEqual(cell.kind, vscode.NotebookCellKind.Code);
      assert.strictEqual(cell.document.getText(), "x = 1 + 1");
      assert.strictEqual(cell.metadata?.pluto_cell_id, cellId);
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
