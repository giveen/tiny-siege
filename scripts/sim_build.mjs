// Bundle the headless balance harness with rolldown (already a Vite
// dependency — no new packages) and run it in plain Node. All args pass
// through to the harness:
//
//   node scripts/sim_build.mjs --seeds 20 --cap-seconds 900
//   npm run sim -- --seeds 20
import { rolldown } from "rolldown";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "node_modules", ".cache", "balance_sim.mjs");
mkdirSync(path.dirname(outfile), { recursive: true });

const bundle = await rolldown({
  input: path.join(root, "scripts", "balance_sim.ts"),
  platform: "node",
  logLevel: "warn",
});
await bundle.write({ file: outfile, format: "esm" });
await bundle.close();

execFileSync(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
});
