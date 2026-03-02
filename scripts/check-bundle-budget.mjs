import { readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const assetsDir = resolve("dist/assets");
const SAFE_ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const resolveSafeAssetPath = (assetName) => {
  // Aikido/SAST hardening: only allow simple filenames emitted by the bundler.
  if (isAbsolute(assetName) || !SAFE_ASSET_NAME_RE.test(assetName)) {
    throw new Error(`Refusing suspicious asset name: ${assetName}`);
  }
  // Avoid dynamic path resolution on untrusted input; we only accept basename-like names above.
  return `${assetsDir}${sep}${assetName}`;
};

// Increased after onboarding/menu additions moved a small amount of shared code
// into the main entry chunk. Keep a guardrail while avoiding false CI failures.
const maxMainBytes = 52 * 1024;
const maxPublicHomeBytes = 20 * 1024;

const files = readdirSync(assetsDir);
const findAssetSize = (prefix) => {
  const candidates = files
    .filter((name) => name.startsWith(prefix) && name.endsWith(".js"))
    .map((name) => {
      const stats = statSync(resolveSafeAssetPath(name));
      return {
        name,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);

  if (!candidates.length) return null;
  const [asset] = candidates;
  return { name: asset.name, size: asset.size };
};

const mainChunk = findAssetSize("index-");
const landingChunk = findAssetSize("PublicHome-");

const failures = [];

if (!mainChunk) {
  failures.push("Missing main chunk (index-*.js)");
} else if (mainChunk.size > maxMainBytes) {
  failures.push(`Main chunk ${mainChunk.name} is ${mainChunk.size} bytes (> ${maxMainBytes})`);
}

if (!landingChunk) {
  failures.push("Missing landing chunk (PublicHome-*.js)");
} else if (landingChunk.size > maxPublicHomeBytes) {
  failures.push(
    `Landing chunk ${landingChunk.name} is ${landingChunk.size} bytes (> ${maxPublicHomeBytes})`
  );
}

if (failures.length) {
  console.error("[perf] Bundle budget check failed:");
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log("[perf] Bundle budget check passed", {
  main: mainChunk,
  landing: landingChunk,
});
