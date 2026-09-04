import { DEFAULTS, VERSION } from "./config.ts";
import { type Status, describeHost } from "./discover.ts";
import { bold, cyan, dim, err, green, row, yellow } from "./ui.ts";

const CMD = "npx @plutojl/cli";

function section(title: string, lines: string[]): string {
  return [bold(title), ...lines].join("\n");
}

function opt(flag: string, text: string): string {
  return row(cyan(flag), text, 24 + (cyan(flag).length - flag.length));
}

function cmd(name: string, text: string): string {
  return row(cyan(name), text, 11 + (cyan(name).length - name.length));
}

export function helpText(): string {
  return [
    `${bold("@plutojl/cli")} ${dim(`v${VERSION}`)} — drive Pluto.jl notebooks from the terminal`,
    "",
    section("Usage", [`  ${CMD} ${cyan("<command>")} [options]`]),
    "",
    section("Commands", [
      cmd("run", "Start Pluto and the tool server (Ctrl+C stops both)"),
      cmd(
        "status",
        "Show whether Pluto and a tool server are running (--wait blocks until both are)"
      ),
      cmd("tools", "List notebook tools; `tools <name>` shows its parameters"),
      cmd("call", "Call a notebook tool: `call <tool> [json]`"),
      cmd("install", "Write MCP config so AI assistants can connect"),
      cmd("help", "Show this help"),
      cmd("version", "Print the version"),
    ]),
    "",
    section("Options for run", [
      opt(
        "--pluto-port <port>",
        `Pluto server port ${dim(`(default ${DEFAULTS.plutoPort})`)}`
      ),
      opt(
        "--pluto-url <url>",
        "Connect to a Pluto server that is already running"
      ),
      opt(
        "--mcp-port <port>",
        `Tool server port ${dim(`(default ${DEFAULTS.mcpPort})`)}`
      ),
      opt(
        "--julia-version <ver>",
        `juliaup channel, or 'default' for your current julia ${dim(`(default ${DEFAULTS.juliaVersion})`)}`
      ),
      opt("--update", "Re-install and precompile Pluto before starting"),
      opt("--no-pluto", "Start the tool server only"),
    ]),
    "",
    section("Options for status", [
      opt("--wait", "Block until a tool server with Pluto connected answers"),
      opt(
        "--timeout <seconds>",
        `Give up waiting after this long ${dim("(default 600)")}`
      ),
      opt("--json", "Print the status as JSON"),
    ]),
    "",
    section("Options for call", [
      opt(
        "--timeout <seconds>",
        `How long to wait for the result ${dim("(default 120)")}`
      ),
      opt("--raw", "Print the raw JSON-RPC result"),
      opt("--mcp-port <port>", "Tool server to talk to"),
    ]),
    "",
    section("Options for install", [
      opt(
        "--target <t>",
        `claude-code, copilot, or all ${dim("(default claude-code)")}`
      ),
      opt(
        "--global",
        "Claude Code: write ~/.claude.json instead of ./.mcp.json"
      ),
      opt("--dry-run", "Print the config instead of writing it"),
      opt("--force", "Replace an existing pluto-notebook entry"),
      opt("--mcp-port <port>", "Tool server port to put in the config"),
    ]),
    "",
    section("Examples", [
      `  ${CMD} run`,
      `  ${CMD} run --pluto-url http://localhost:1234`,
      `  ${CMD} call open_notebook '{"path": "notebook.pluto.jl"}'`,
      `  ${CMD} call execute_code '{"code": "1 + 1"}'`,
      `  ${CMD} tools open_notebook`,
      `  ${CMD} install --target all`,
    ]),
    "",
    dim(
      `Config: flags > env (PLUTO_MCP_PORT, PLUTO_PORT, PLUTO_SERVER_URL, JULIA_VERSION) > .plutomcp.json > defaults`
    ),
  ].join("\n");
}

export function statusText(status: Status): string {
  const lines: string[] = [];

  const { pluto, mcp } = status;
  lines.push(
    row(
      "Pluto",
      pluto.running
        ? `${green("running")} at ${pluto.url}`
        : `${dim("not running")} at ${pluto.url}`
    )
  );

  if (mcp) {
    const owner =
      mcp.host === "unknown" ? "" : ` ${dim(`(${describeHost(mcp.host)})`)}`;
    const details = [
      `${green("running")}${owner} at ${mcp.url}`,
      mcp.plutoRunning
        ? green("Pluto connected")
        : yellow("Pluto not connected"),
      dim(`${mcp.sessions} session${mcp.sessions === 1 ? "" : "s"}`),
    ];
    lines.push(row("Tool server", details.join(dim(" · "))));
  } else {
    lines.push(
      row("Tool server", `${dim("not running")} on port ${status.mcpPort}`)
    );
  }

  const hints: string[] = [];
  if (!mcp) {
    if (status.insideVSCode) {
      hints.push(
        `You are inside VS Code: the Advanced Pluto Notebook extension provides a tool server automatically once installed.`
      );
    }
    hints.push(`Start one with: ${CMD} run`);
  } else if (mcp.host === "vscode" && !status.insideVSCode) {
    hints.push(
      `The tool server belongs to a VS Code window; \`${CMD} call\` will use it.`
    );
  } else if (mcp && !mcp.plutoRunning && !pluto.running) {
    hints.push(`Start Pluto with: ${CMD} call start_pluto_server`);
  }

  return [bold("Status"), ...lines, ...hints.map((h) => `  ${dim(h)}`)].join(
    "\n"
  );
}

/** Styled for stderr. */
export function usageErrorText(message: string): string {
  return `${err.red("error:")} ${message}\n${err.dim(`Run '${CMD} help' for usage.`)}`;
}
