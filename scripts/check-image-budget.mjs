import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const SOURCE_IMAGE_DIR = "src/assets/landing";
const DIST_IMAGE_DIR = "dist/assets";

const MAX_SOURCE_PNG_BYTES = 160 * 1024;
const MAX_SOURCE_WEBP_BYTES = 80 * 1024;
const MAX_DIST_IMAGE_BYTES = 220 * 1024;

const getExt = (name) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};

const failures = [];

for (const file of readdirSync(SOURCE_IMAGE_DIR)) {
  const ext = getExt(file);
  if (!IMAGE_EXTENSIONS.has(ext)) continue;
  const size = statSync(join(SOURCE_IMAGE_DIR, file)).size;
  if (ext === ".png" && size > MAX_SOURCE_PNG_BYTES) {
    failures.push(`${SOURCE_IMAGE_DIR}/${file} is ${size} bytes (> ${MAX_SOURCE_PNG_BYTES})`);
  }
  if ((ext === ".webp" || ext === ".avif") && size > MAX_SOURCE_WEBP_BYTES) {
    failures.push(`${SOURCE_IMAGE_DIR}/${file} is ${size} bytes (> ${MAX_SOURCE_WEBP_BYTES})`);
  }
}

for (const file of readdirSync(DIST_IMAGE_DIR)) {
  const ext = getExt(file);
  if (!IMAGE_EXTENSIONS.has(ext)) continue;
  const size = statSync(join(DIST_IMAGE_DIR, file)).size;
  if (size > MAX_DIST_IMAGE_BYTES) {
    failures.push(`${DIST_IMAGE_DIR}/${file} is ${size} bytes (> ${MAX_DIST_IMAGE_BYTES})`);
  }
}

if (failures.length > 0) {
  console.error("[perf] Image budget check failed:");
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log("[perf] Image budget check passed");
