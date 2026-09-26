import {
  MCP_SERVER_NAME,
  mcpEndpointUrl,
  upsertMcpServer,
} from "../mcpClientConfig.ts";

const url = mcpEndpointUrl(3100);

describe("upsertMcpServer", () => {
  it("creates a config from a missing file", () => {
    const result = upsertMcpServer(undefined, { format: "claude-code", url });
    expect(result).toEqual({
      kind: "updated",
      config: {
        mcpServers: {
          [MCP_SERVER_NAME]: { type: "http", url: "http://localhost:3100/mcp" },
        },
      },
      text: expect.stringMatching(/\n$/),
    });
  });

  it("adds the entry beside other servers and keys", () => {
    const raw = JSON.stringify({
      mcpServers: { other: { type: "stdio", command: "x" } },
      keep: 1,
    });
    const result = upsertMcpServer(raw, { format: "claude-code", url });
    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") return;
    expect(result.config.keep).toBe(1);
    expect(result.config.mcpServers).toEqual({
      other: { type: "stdio", command: "x" },
      [MCP_SERVER_NAME]: { type: "http", url },
    });
    expect(JSON.parse(result.text)).toEqual(result.config);
  });

  it("writes VS Code's servers map with an inputs array", () => {
    const result = upsertMcpServer("\uFEFF{}", { format: "vscode", url });
    expect(result.kind === "updated" && result.config).toEqual({
      servers: { [MCP_SERVER_NAME]: { type: "http", url } },
      inputs: [],
    });
  });

  it.each([
    ["{ not json", /not valid JSON/],
    ["[]", /JSON object/],
    ["null", /JSON object/],
    ['{"mcpServers": []}', /"mcpServers" that is not a JSON object/],
  ])("refuses to merge into unparseable config %s", (raw, reason) => {
    const result = upsertMcpServer(raw, {
      format: "claude-code",
      url,
      force: true,
    });
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.reason).toMatch(reason);
  });

  describe("with an existing entry", () => {
    const raw = (entryUrl: string) =>
      JSON.stringify({
        mcpServers: {
          other: { command: "x" },
          [MCP_SERVER_NAME]: { type: "http", url: entryUrl },
        },
      });

    it("keeps a different entry unless forced", () => {
      expect(
        upsertMcpServer(raw("http://localhost:9999/mcp"), {
          format: "claude-code",
          url,
        })
      ).toEqual({ kind: "exists", current: false });

      const forced = upsertMcpServer(raw("http://localhost:9999/mcp"), {
        format: "claude-code",
        url,
        force: true,
      });
      expect(forced.kind === "updated" && forced.config.mcpServers).toEqual({
        other: { command: "x" },
        [MCP_SERVER_NAME]: { type: "http", url },
      });
    });

    it("reports an entry with the same values in another key order as current", () => {
      const reordered = JSON.stringify({
        mcpServers: { [MCP_SERVER_NAME]: { url, type: "http" } },
      });
      expect(
        upsertMcpServer(reordered, { format: "claude-code", url })
      ).toEqual({ kind: "exists", current: true });
    });

    it("reports an identical entry as current", () => {
      expect(upsertMcpServer(raw(url), { format: "claude-code", url })).toEqual(
        { kind: "exists", current: true }
      );
    });
  });
});
