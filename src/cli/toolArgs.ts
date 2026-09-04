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
