import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const assetsDir = "dist/assets";
const reportPath = "artifacts/perf-report.json";

const top = readdirSync(assetsDir)
  .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
  .map((name) => ({ name, bytes: statSync(join(assetsDir, name)).size }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 20);

const report = {
  generated_at: new Date().toISOString(),
  top_assets: top,
};

mkdirSync("artifacts", { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`[perf] wrote ${reportPath}`);
