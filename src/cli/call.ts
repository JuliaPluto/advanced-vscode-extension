import * as fs from "fs";
import * as path from "path";
import { extensionFor } from "../notebookOutput.ts";
import {
  readToolArgsSource,
  resolvePathArgs,
  withCodeFile,
} from "./toolArgs.ts";
import { type ToolInfo, withToolClient } from "./toolClient.ts";
import { bold, cyan, dim, err, yellow } from "./ui.ts";

/** First sentence of a description, for the one-line listing. */
function summary(text: string | undefined): string {
  if (!text) return "";
  const match = /^(.+?[.!?])(\s|$)/.exec(text);
  return match ? match[1] : text;
}

function describeTool(tool: ToolInfo): string {
  const lines = [bold(tool.name)];
  if (tool.description) {
    lines.push(`  ${tool.description}`);
  }
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const names = Object.keys(props);
  lines.push("");
  if (names.length === 0) {
    lines.push(`  ${dim("no parameters")}`);
  } else {
    lines.push(`  ${dim("Parameters")}`);
    const width = Math.max(...names.map((n) => n.length));
    for (const name of names) {
      const schema = props[name];
      const type = schema.enum
        ? schema.enum.map(String).join(" | ")
        : (schema.type ?? "any");
      const flags = [
        required.has(name) ? yellow("required") : "",
        schema.default !== undefined
          ? dim(`default ${JSON.stringify(schema.default)}`)
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `    ${cyan(name.padEnd(width))}  ${dim(type)}${flags ? "  " + flags : ""}`
      );
      if (schema.description) {
        lines.push(`    ${" ".repeat(width)}  ${schema.description}`);
      }
    }
  }
  lines.push("");
  const example: Record<string, unknown> = {};
  for (const name of names) {
    if (required.has(name)) {
      example[name] = props[name].type === "number" ? 0 : `<${name}>`;
    }
  }
  lines.push(
    `  ${dim("Example")}  npx @plutojl/cli call ${tool.name}${
      names.length ? ` '${JSON.stringify(example)}'` : ""
    }`
  );
  return lines.join("\n");
}

export async function listTools(port: number, filter?: string): Promise<void> {
  const tools = await withToolClient(port, (client) => client.listTools());

  if (filter) {
    const tool = tools.find((t) => t.name === filter);
    if (!tool) {
      const close = tools
        .filter((t) => t.name.includes(filter))
        .map((t) => t.name);
      console.error(
        `${err.red("error:")} no tool named '${filter}'` +
          (close.length ? `. Did you mean: ${close.join(", ")}?` : "")
      );
      process.exit(1);
    }
    console.log(describeTool(tool));
    return;
  }

  if (tools.length === 0) {
    console.log("No tools available.");
    return;
  }

  console.log(
    `  ${dim("Start with")} npx @plutojl/cli call learn_pluto_basics ${dim("— environments, paths, reactivity rules, and the workflow.")}\n`
  );
  const maxLen = Math.max(...tools.map((t) => t.name.length));
  for (const tool of tools) {
    const params = Object.keys(tool.inputSchema?.properties ?? {});
    const paramStr = params.length > 0 ? dim(`  (${params.join(", ")})`) : "";
    console.log(
      `  ${cyan(tool.name.padEnd(maxLen))}  ${summary(tool.description)}${paramStr}`
    );
  }
  console.log(
    dim(`\n  npx @plutojl/cli tools <name> shows a tool's parameters.`)
  );
}

export interface CallOptions {
  raw: boolean;
  timeoutMs: number;
  /** Where to write image content; defaults to ./<cell_id or tool>.<ext>. */
  out?: string;
  /** File (or `-` for stdin) whose contents become the `code` argument. */
  codeFile?: string;
}

export async function callTool(
  port: number,
  toolName: string,
  argsJson: string,
  options: CallOptions
): Promise<void> {
  const { raw, timeoutMs, out, codeFile } = options;
  let source: string;
  try {
    source = readToolArgsSource(argsJson, process.cwd());
  } catch (e) {
    console.error(
      `${err.red("error:")} could not read tool arguments from ${argsJson}: ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error(
      `${err.red("error:")} tool arguments must be a JSON object, got: ${source.slice(0, 200)}`
    );
    console.error(
      err.dim(
        `  e.g. npx @plutojl/cli call ${toolName} '{"path": "nb.pluto.jl"}'  (or @args.json, or - for stdin)`
      )
    );
    process.exit(1);
  }
  let args = resolvePathArgs(parsed as Record<string, unknown>, process.cwd());
  if (codeFile !== undefined) {
    try {
      args = withCodeFile(args, codeFile, process.cwd());
    } catch (e) {
      console.error(
        `${err.red("error:")} --code-file ${codeFile}: ${e instanceof Error ? e.message : String(e)}`
      );
      process.exit(1);
    }
  }

  const result = await withToolClient(port, (client) =>
    client.callTool(toolName, args, timeoutMs)
  );

  if (raw) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    let imageIndex = 0;
    for (const item of result.content ?? []) {
      if (item.type === "text" && item.text) {
        console.log(item.text);
      } else if (item.type === "image" && item.data) {
        // Never print base64 to the terminal: save the image and say where
        const ext = extensionFor(item.mimeType ?? "image/png");
        const stem = typeof args.cell_id === "string" ? args.cell_id : toolName;
        const dest =
          out ??
          path.resolve(`${stem}${imageIndex ? `-${imageIndex}` : ""}.${ext}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(item.data, "base64"));
        console.log(
          `${dim("image")} ${item.mimeType ?? ""} written to ${dest}`
        );
        imageIndex++;
      }
    }
  }

  if (result.isError) {
    process.exit(1);
  }
}
