import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDir = "dist/assets";

const maxMainBytes = 40 * 1024;
const maxPublicHomeBytes = 20 * 1024;

const files = readdirSync(assetsDir);
const findAssetSize = (prefix) => {
  const candidates = files
    .filter((name) => name.startsWith(prefix) && name.endsWith(".js"))
    .map((name) => {
      const stats = statSync(join(assetsDir, name));
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
