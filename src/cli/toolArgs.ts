import * as fs from "fs";
import * as path from "path";

/** Tool arguments that name files; relative values are resolved against the caller's cwd. */
const PATH_ARGS = ["path", "output_path", "new_path"];

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
 * know the caller's working directory), so resolve relative file
 * arguments here, where that directory is known.
 */
export function resolvePathArgs(
  args: Record<string, unknown>,
  cwd: string
): Record<string, unknown> {
  const out = { ...args };
  for (const key of PATH_ARGS) {
    const value = out[key];
    if (typeof value === "string" && value !== "" && !path.isAbsolute(value)) {
      out[key] = path.resolve(cwd, value);
    }
  }
  return out;
}
