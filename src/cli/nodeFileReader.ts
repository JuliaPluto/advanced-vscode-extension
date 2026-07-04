import { readFile } from "fs/promises";
import type { IFileReader } from "../plutoManagerTypes.ts";

export class NodeFileReader implements IFileReader {
  async readFile(path: string): Promise<string> {
    return await readFile(path, "utf-8");
  }
}
