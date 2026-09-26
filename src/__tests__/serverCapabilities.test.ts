import {
  describeFileSync,
  isLoopbackUrl,
  requireCapability,
  serverCapabilities,
} from "../serverCapabilities.ts";

describe("serverCapabilities", () => {
  it("lets a local server that writes files keep the file itself", () => {
    const caps = serverCapabilities({
      sharesFilesystem: true,
      writesNotebookFiles: true,
    });
    expect(caps).toEqual({
      fileSync: "server-writes-file",
      moveNotebook: { ok: true },
      writeLocalFile: { ok: true },
    });
  });

  it("leaves the file to the editor when a local server does not write it", () => {
    const caps = serverCapabilities({
      sharesFilesystem: true,
      writesNotebookFiles: false,
    });
    expect(caps.fileSync).toBe("editor-writes-file");
    expect(caps.moveNotebook.ok).toBe(true);
    expect(caps.writeLocalFile.ok).toBe(true);
  });

  it.each([true, false])(
    "refuses a remote server's disk operations whatever it writes (writes=%s)",
    (writesNotebookFiles) => {
      const caps = serverCapabilities({
        sharesFilesystem: false,
        writesNotebookFiles,
      });
      expect(caps.fileSync).toBe("server-holds-copy");
      expect(() => requireCapability(caps.moveNotebook)).toThrow(
        "Moving a notebook only works when the Pluto server is on localhost"
      );
      expect(() => requireCapability(caps.writeLocalFile)).toThrow(
        "Rendering to a file needs a Pluto server on localhost"
      );
    }
  );

  it("describes each way the file is kept", () => {
    expect(describeFileSync("server-writes-file")).toContain(
      "will save changes to it"
    );
    expect(describeFileSync("editor-writes-file")).toContain(
      "saved in the editor, or through save_notebook"
    );
    expect(describeFileSync("server-holds-copy")).toContain(
      "NOT synced with the server"
    );
  });

  it.each([
    ["http://localhost:1234", true],
    ["http://127.0.0.1:1234", true],
    ["http://[::1]:1234", true],
    ["http://0.0.0.0:1234", true],
    ["http://10.0.0.99:1234", false],
    ["https://pluto.example.com", false],
    ["not a url", false],
  ])("treats %s as this machine: %s", (url, loopback) => {
    expect(isLoopbackUrl(url)).toBe(loopback);
  });
});
