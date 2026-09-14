import * as vscode from "vscode";
import {
  MCP_SERVER_DEFINITION_PROVIDER_ID,
  getMcpEndpoint,
  registerMcpServerDefinitionProvider,
} from "../mcpServerDefinitionProvider.ts";
import {
  cleanupMCPServer,
  getMCPServer,
  initializeMCPServer,
  stopMCPServer,
} from "../mcp-server-http.ts";
import { findAvailablePort } from "../portUtils.ts";
import type { PlutoManager } from "../plutoManager.ts";

const { registeredMcpProviders } = vscode as unknown as {
  registeredMcpProviders: Array<{
    id: string;
    provider: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>;
  }>;
};

const outputChannel = {
  appendLine: () => {},
} as unknown as vscode.OutputChannel;

function makeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function disposeAll(context: vscode.ExtensionContext): void {
  for (const subscription of context.subscriptions) subscription.dispose();
}

const plutoManager = {
  isRunning: () => false,
  isConnected: () => false,
} as unknown as PlutoManager;

describe("registerMcpServerDefinitionProvider", () => {
  afterEach(async () => {
    await stopMCPServer();
    cleanupMCPServer();
    registeredMcpProviders.length = 0;
  });

  it("registers under the id contributed in package.json", () => {
    const context = makeContext();
    registerMcpServerDefinitionProvider(context, outputChannel);
    expect(registeredMcpProviders.map((entry) => entry.id)).toEqual([
      MCP_SERVER_DEFINITION_PROVIDER_ID,
    ]);
    disposeAll(context);
    expect(registeredMcpProviders).toHaveLength(0);
  });

  it("advertises the configured port before the server starts", () => {
    const context = makeContext();
    registerMcpServerDefinitionProvider(context, outputChannel);
    const definitions =
      registeredMcpProviders[0].provider.provideMcpServerDefinitions(
        {} as vscode.CancellationToken
      ) as vscode.McpHttpServerDefinition[];
    expect(definitions).toHaveLength(1);
    expect(definitions[0].label).toBe("Pluto Notebook");
    expect(definitions[0].uri.toString()).toBe("http://localhost:3100/mcp");
    disposeAll(context);
  });

  it("follows the port the server actually listens on and reports changes", async () => {
    const port = await findAvailablePort(3300);
    initializeMCPServer(plutoManager, port, outputChannel, "1.2.3");
    const context = makeContext();
    registerMcpServerDefinitionProvider(context, outputChannel);
    const { provider } = registeredMcpProviders[0];

    let changes = 0;
    provider.onDidChangeMcpServerDefinitions!(() => changes++);

    const resolved = (await provider.resolveMcpServerDefinition!(
      new vscode.McpHttpServerDefinition("Pluto Notebook", getMcpEndpoint()),
      {} as vscode.CancellationToken
    )) as vscode.McpHttpServerDefinition;

    expect(getMCPServer()?.isRunning()).toBe(true);
    expect(resolved.uri.toString()).toBe(
      `http://localhost:${getMCPServer()!.getPort()}/mcp`
    );
    expect(changes).toBe(1);

    await stopMCPServer();
    expect(changes).toBe(2);
    disposeAll(context);
  });
});
