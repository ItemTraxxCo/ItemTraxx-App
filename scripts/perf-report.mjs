import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const assetsDir = resolve("dist/assets");
const reportPath = resolve("artifacts/perf-report.json");
const SAFE_ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const resolveSafeAssetPath = (assetName) => {
  // Aikido/SAST hardening: only allow simple filenames emitted by the bundler.
  if (isAbsolute(assetName) || !SAFE_ASSET_NAME_RE.test(assetName)) {
    throw new Error(`Refusing suspicious asset name: ${assetName}`);
  }
  // Avoid dynamic path resolution on untrusted input; we only accept basename-like names above.
  return `${assetsDir}${sep}${assetName}`;
};

const top = readdirSync(assetsDir)
  .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
  .map((name) => ({ name, bytes: statSync(resolveSafeAssetPath(name)).size }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 20);

const report = {
  generated_at: new Date().toISOString(),
  top_assets: top,
};

mkdirSync(resolve("artifacts"), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`[perf] wrote ${reportPath}`);
