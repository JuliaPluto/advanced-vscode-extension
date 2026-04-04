import * as vscode from "vscode";
import type { IFileReader } from "./plutoManagerTypes.ts";

export class VscodeFileReader implements IFileReader {
  async readFile(path: string): Promise<string> {
    const uri = vscode.Uri.file(path);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  }
}
