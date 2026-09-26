import * as fs from "fs";
import type * as vscode from "vscode";
import { commandTable, type CommandDeps } from "../commands/index.ts";

describe("commandTable", () => {
  it("has a handler for every command package.json contributes", () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8")
    );
    const contributed: string[] = pkg.contributes.commands.map(
      (c: { command: string }) => c.command
    );
    const table = commandTable(
      {} as vscode.ExtensionContext,
      {} as CommandDeps
    );
    expect(Object.keys(table)).toEqual(expect.arrayContaining(contributed));
    expect(
      Object.keys(table).filter((id) => !contributed.includes(id))
    ).toEqual(["pluto-notebook.focusCellFromTree"]);
  });
});
