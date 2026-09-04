import esbuild from "esbuild";
import { chmodSync, mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf-8")
);

async function main() {
  mkdirSync("dist", { recursive: true });

  const ctx = await esbuild.context({
    entryPoints: [join(__dirname, "../../src/cli/index.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/cli.cjs",
    banner: {
      js: "#!/usr/bin/env node",
    },
    define: {
      __CLI_VERSION__: JSON.stringify(version),
    },
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    // vscode must never be bundled — fail loudly if it leaks
    external: ["vscode"],
    // Ensure esbuild can resolve modules from root node_modules
    nodePaths: [join(__dirname, "../../node_modules")],
    loader: {
      ".md": "text",
    },
    logLevel: "info",
  });

  if (watch) {
    console.log("[cli-watch] watching for changes...");
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    // Make the output executable
    try {
      chmodSync("dist/cli.cjs", 0o755);
    } catch {
      // chmod not available on Windows; npm bin handles it
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
