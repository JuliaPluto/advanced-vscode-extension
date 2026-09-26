import { jest } from "@jest/globals";
import { createPlutoTools, type PlutoToolsManager } from "../mcpTools/index.js";
import { otherPlutoServerMessage, sameUrl } from "../plutoServerUrl.js";

const CONFIGURED = "http://localhost:1234";

function createPlutoManager(connected: boolean) {
  const manager = {
    connected,
    status: "stopped",
    isConnected: () => manager.connected,
    getState: () => ({ status: manager.status }),
    start: jest.fn(async () => {}),
    getServerUrl: () => CONFIGURED,
    connect: jest.fn(async () => {
      manager.connected = true;
    }),
  };
  return manager;
}

async function callConnect(
  plutoManager: unknown,
  args: Record<string, unknown>
): Promise<{ isError: boolean; text: string }> {
  const result = await createPlutoTools(plutoManager as PlutoToolsManager).call(
    "connect_to_pluto_server",
    args
  );
  const [content] = result.content as Array<{ text: string }>;
  return { isError: !!result.isError, text: content.text };
}

describe("sameUrl", () => {
  it("ignores a trailing slash and host case", () => {
    expect(sameUrl("http://LOCALHOST:1234/", "http://localhost:1234")).toBe(
      true
    );
  });
  it("tells different ports apart", () => {
    expect(sameUrl("http://localhost:1235", "http://localhost:1234")).toBe(
      false
    );
  });
});

describe("connect_to_pluto_server", () => {
  it("connects to the configured server without a url", async () => {
    const manager = createPlutoManager(false);
    const result = await callConnect(manager, {});
    expect(result).toEqual({
      isError: false,
      text: `Connected to Pluto server at ${CONFIGURED}`,
    });
    expect(manager.connect).toHaveBeenCalledWith();
  });

  it("connects when the url names the configured server", async () => {
    const manager = createPlutoManager(false);
    const result = await callConnect(manager, { url: `${CONFIGURED}/` });
    expect(result.isError).toBe(false);
    expect(manager.connect).toHaveBeenCalledWith();
  });

  it.each([false, true])(
    "refuses a different url without connecting (connected: %s)",
    async (connected) => {
      const manager = createPlutoManager(connected);
      const result = await callConnect(manager, {
        url: "http://localhost:9999",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(
        otherPlutoServerMessage(CONFIGURED, "http://localhost:9999")
      );
      expect(result.text).not.toContain("stop_pluto_server");
      expect(manager.connect).not.toHaveBeenCalled();
    }
  );

  it("rejects a non-http url", async () => {
    const manager = createPlutoManager(false);
    const result = await callConnect(manager, { url: "file:///etc/passwd" });
    expect(result.isError).toBe(true);
    expect(manager.connect).not.toHaveBeenCalled();
  });

  it("waits for a start in flight before deciding", async () => {
    const manager = createPlutoManager(false);
    manager.status = "starting";
    manager.start = jest.fn(async () => {
      manager.connected = true;
    });
    const result = await callConnect(manager, { url: CONFIGURED });
    expect(manager.start).toHaveBeenCalled();
    expect(result.text).toBe(
      `Already connected to a Pluto server at ${CONFIGURED}`
    );
  });
});
