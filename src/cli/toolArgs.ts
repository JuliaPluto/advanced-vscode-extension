import * as fs from "fs";
import * as path from "path";
import type { ToolInfo, ToolSchema } from "./toolClient.ts";

/**
 * Turn the `call` argument into a JSON string: `-` reads stdin, `@file`
 * reads a file, anything else is taken as the JSON itself.
 */
export function readToolArgsSource(arg: string, cwd: string): string {
  if (arg === "-") {
    return fs.readFileSync(0, "utf-8");
  }
  if (arg.startsWith("@") && arg.length > 1) {
    return fs.readFileSync(path.resolve(cwd, arg.slice(1)), "utf-8");
  }
  return arg;
}

/**
 * Set the `code` argument from a file (`-` reads stdin), dropping the
 * file's final newline. Refuses when the arguments already carry `code`.
 */
export function withCodeFile(
  args: Record<string, unknown>,
  codeFile: string,
  cwd: string
): Record<string, unknown> {
  if ("code" in args) {
    throw new Error(
      "pass the cell code either as the code argument or with --code-file, not both"
    );
  }
  const code =
    codeFile === "-"
      ? fs.readFileSync(0, "utf-8")
      : fs.readFileSync(path.resolve(cwd, codeFile), "utf-8");
  return { ...args, code: code.replace(/\r?\n$/, "") };
}

/**
 * Notebook tools identify notebooks by absolute path (the server cannot
 * know the caller's working directory), so relative values of the
 * arguments the tool's schema marks with `x-pluto-path` are resolved here,
 * where that directory is known.
 */
export function resolvePathArgs(
  args: Record<string, unknown>,
  tool: ToolInfo,
  cwd: string
): Record<string, unknown> {
  const out = { ...args };
  for (const [key, schema] of Object.entries(
    tool.inputSchema?.properties ?? {}
  )) {
    const value = out[key];
    if (
      schema["x-pluto-path"] &&
      typeof value === "string" &&
      value !== "" &&
      !path.isAbsolute(value)
    ) {
      out[key] = path.resolve(cwd, value);
    }
  }
  return out;
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function checkValue(
  name: string,
  schema: ToolSchema,
  value: unknown
): string[] {
  if (schema.enum && !schema.enum.includes(value)) {
    return [
      `${name} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}, got ${JSON.stringify(value)}`,
    ];
  }
  const expected = schema.type;
  if (expected === undefined) return [];
  const actual = typeOf(value);
  const matches =
    expected === "integer" ? Number.isInteger(value) : expected === actual;
  if (!matches) {
    return [
      `${name} must be ${expected === "array" || expected === "integer" ? "an" : "a"} ${expected}, got ${actual}`,
    ];
  }
  if (expected === "array" && schema.items && Array.isArray(value)) {
    return value.flatMap((item, i) =>
      checkValue(`${name}[${i}]`, schema.items!, item)
    );
  }
  return [];
}

/**
 * What is wrong with `args` for `tool`, checked against the tool's input
 * schema: unknown and missing arguments, and top-level types and enums.
 * The server validates in full; this catches what it would drop silently.
 */
export function checkToolArgs(
  args: Record<string, unknown>,
  tool: ToolInfo
): string[] {
  const properties = tool.inputSchema?.properties ?? {};
  const problems: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    const schema = properties[name];
    if (!schema) {
      problems.push(`unknown argument ${name}`);
    } else {
      problems.push(...checkValue(name, schema, value));
    }
  }
  for (const name of tool.inputSchema?.required ?? []) {
    if (!(name in args)) {
      problems.push(`missing required argument ${name}`);
    }
  }
  return problems;
}
