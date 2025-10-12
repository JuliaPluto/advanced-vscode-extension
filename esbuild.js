import esbuild from "esbuild";

import { copyFileSync, mkdirSync } from "fs";
import { join } from "path";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`
        );
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  // Copy xhr-sync-worker.js to dist if it exists
  try {
    mkdirSync("dist", { recursive: true });
    copyFileSync(
      join("node_modules", "xhr-sync", "lib", "xhr-sync-worker.js"),
      join("dist", "xhr-sync-worker.js")
    );
  } catch (e) {
    // Worker file might not exist in all versions
    console.warn("Could not copy xhr-sync-worker.js:", e.message);
  }

  // Build extension
  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",

    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.cjs",
    external: ["vscode"],
    logLevel: "silent",
    loader: {
      ".md": "text", // Load markdown files as text
    },
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });

  // Build renderer
  const rendererCtx = await esbuild.context({
    entryPoints: ["renderer/renderer.tsx"],
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/renderer.js",
    logLevel: "info",
    plugins: [esbuildProblemMatcherPlugin],
    jsx: "automatic",
    jsxImportSource: "preact",
    loader: {
      ".tsx": "tsx",
      ".ts": "tsx",
      ".css": "text",
    },
  });

  if (watch) {
    await extensionCtx.watch();
    await rendererCtx.watch();
  } else {
    await extensionCtx.rebuild();
    await rendererCtx.rebuild();
    await extensionCtx.dispose();
    await rendererCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
