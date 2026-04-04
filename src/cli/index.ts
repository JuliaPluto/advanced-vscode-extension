import { parseArgs } from "./parseArgs.ts";
import { resolveRunConfig, resolveInstallArgs } from "./resolveConfig.ts";
import { run } from "./run.ts";
import { installMcpConfig } from "./install.ts";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "run": {
      const config = resolveRunConfig(args);
      await run(config);
      break;
    }
    case "install": {
      const installArgs = resolveInstallArgs(args);
      await installMcpConfig(installArgs);
      break;
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
