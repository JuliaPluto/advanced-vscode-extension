export type Command =
  "help" | "version" | "status" | "run" | "tools" | "call" | "install";

export interface RawArgs {
  command: Command;
  mcpPort?: number;
  plutoPort?: number;
  plutoUrl?: string;
  juliaVersion?: string;
  // run
  noPluto?: boolean;
  update?: boolean;
  // install
  target?: "claude-code" | "copilot" | "all";
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  // tools
  toolFilter?: string;
  // call
  toolName?: string;
  toolArgs?: string;
  raw?: boolean;
  timeoutSeconds?: number;
  // status
  json?: boolean;
  wait?: boolean;
}

/** A user mistake on the command line; the message is printed with the usage hint. */
export class UsageError extends Error {}

export const COMMANDS: Command[] = [
  "run",
  "status",
  "tools",
  "call",
  "install",
  "help",
  "version",
];

interface FlagSpec {
  /** Commands this flag is valid for. */
  commands: Command[];
  /** Whether the flag consumes a value. */
  value: boolean;
  apply: (args: RawArgs, value: string | undefined, flag: string) => void;
}

function parsePort(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new UsageError(`${flag} expects a port number, got '${value}'`);
  }
  return n;
}

const SERVER_COMMANDS: Command[] = [
  "run",
  "status",
  "tools",
  "call",
  "install",
];

const FLAGS: Record<string, FlagSpec> = {
  "--mcp-port": {
    commands: SERVER_COMMANDS,
    value: true,
    apply: (a, v, f) => (a.mcpPort = parsePort(f, v)),
  },
  "--pluto-port": {
    commands: ["run", "status"],
    value: true,
    apply: (a, v, f) => (a.plutoPort = parsePort(f, v)),
  },
  "--pluto-url": {
    commands: ["run", "status"],
    value: true,
    apply: (a, v) => (a.plutoUrl = v),
  },
  "--julia-version": {
    commands: ["run"],
    value: true,
    apply: (a, v) => (a.juliaVersion = v),
  },
  "--no-pluto": {
    commands: ["run"],
    value: false,
    apply: (a) => (a.noPluto = true),
  },
  "--update": {
    commands: ["run"],
    value: false,
    apply: (a) => (a.update = true),
  },
  "--target": {
    commands: ["install"],
    value: true,
    apply: (a, v) => {
      if (v !== "claude-code" && v !== "copilot" && v !== "all") {
        throw new UsageError(
          `--target expects claude-code, copilot, or all, got '${v}'`
        );
      }
      a.target = v;
    },
  },
  "--global": {
    commands: ["install"],
    value: false,
    apply: (a) => (a.global = true),
  },
  "--dry-run": {
    commands: ["install"],
    value: false,
    apply: (a) => (a.dryRun = true),
  },
  "--force": {
    commands: ["install"],
    value: false,
    apply: (a) => (a.force = true),
  },
  "--raw": {
    commands: ["call"],
    value: false,
    apply: (a) => (a.raw = true),
  },
  "--timeout": {
    commands: ["call", "status"],
    value: true,
    apply: (a, v) => {
      const seconds = Number(v);
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new UsageError(
          `--timeout expects a number of seconds, got '${v}'`
        );
      }
      a.timeoutSeconds = seconds;
    },
  },
  "--json": {
    commands: ["status"],
    value: false,
    apply: (a) => (a.json = true),
  },
  "--wait": {
    commands: ["status"],
    value: false,
    apply: (a) => (a.wait = true),
  },
};

/**
 * Parse argv into a command plus options. The command is the first
 * positional token; other positionals belong to the command (`call <tool>
 * [json]`, `tools [name]`) and may appear before or after flags. Unknown
 * flags and flags that do not apply to the command are errors.
 */
export function parseArgs(argv: string[]): RawArgs {
  const positionals: string[] = [];
  const flags: Array<{ flag: string; value: string | undefined }> = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { command: "help" };
    }
    if (token === "--version" || token === "-V") {
      return { command: "version" };
    }
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const spec = FLAGS[flag];
    if (!spec) {
      throw new UsageError(`Unknown option '${flag}'`);
    }
    let value: string | undefined;
    if (spec.value) {
      if (eq !== -1) {
        value = token.slice(eq + 1);
      } else {
        value = argv[++i];
        if (value === undefined) {
          throw new UsageError(`${flag} requires a value`);
        }
      }
    } else if (eq !== -1) {
      throw new UsageError(`${flag} does not take a value`);
    }
    flags.push({ flag, value });
  }

  const first = positionals.shift();
  if (first === undefined) {
    return { command: "help" };
  }
  if (!COMMANDS.includes(first as Command)) {
    throw new UsageError(`Unknown command '${first}'`);
  }
  const args: RawArgs = { command: first as Command };

  for (const { flag, value } of flags) {
    const spec = FLAGS[flag];
    if (!spec.commands.includes(args.command)) {
      throw new UsageError(
        `${flag} is not valid for '${args.command}' (valid for: ${spec.commands.join(", ")})`
      );
    }
    spec.apply(args, value, flag);
  }

  switch (args.command) {
    case "call":
      if (positionals.length === 0) {
        throw new UsageError("call needs a tool name: call <tool> [json]");
      }
      if (positionals.length > 2) {
        throw new UsageError(
          `call takes at most two arguments (tool name and JSON), got ${positionals.length}`
        );
      }
      args.toolName = positionals[0];
      args.toolArgs = positionals[1];
      break;
    case "tools":
      if (positionals.length > 1) {
        throw new UsageError("tools takes at most one argument: tools [name]");
      }
      args.toolFilter = positionals[0];
      break;
    default:
      if (positionals.length > 0) {
        throw new UsageError(
          `'${args.command}' does not take arguments (got '${positionals[0]}')`
        );
      }
  }

  return args;
}
