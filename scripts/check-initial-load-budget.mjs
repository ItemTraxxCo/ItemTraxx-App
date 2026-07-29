import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_INITIAL_MINIFIED_BYTES = 250_000;
export const MAX_INITIAL_GZIP_BYTES = 100_000;
const SAFE_ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
const FORBIDDEN_INITIAL_MODULE_RE = /node_modules\/(?:jspdf|html2canvas|jsbarcode|posthog-js|@sentry|@supabase)\//;
// Static, unbundled scripts served verbatim from /public that are allowed to
// appear in the initial HTML outside the hashed /assets/ pipeline. Each entry
// must be a small, dependency-free, audited bootstrap script (no npm imports,
// so it can never trip FORBIDDEN_INITIAL_MODULE_RE) — its bytes still count
// against the initial-load budget below.
const ALLOWED_STATIC_ROOT_SCRIPTS = new Set(["theme-init.js"]);

const resolveAssetPath = (assetsDir, assetName) => {
  // Asset names come from the generated HTML, but keep the read explicitly
  // contained in the generated assets directory for defense in depth.
  const assetPath = resolve(assetsDir, assetName);
  const relativePath = relative(resolve(assetsDir), assetPath);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("/")) {
    throw new Error(`asset path escaped assets directory: ${assetName}`);
  }
  return assetPath;
};

const resolveStaticRootAssetPath = (htmlPath, assetName) => {
  const rootDir = resolve(htmlPath, "..");
  const assetPath = resolve(rootDir, assetName);
  const relativePath = relative(rootDir, assetPath);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("/")) {
    throw new Error(`static asset path escaped output root: ${assetName}`);
  }
  return assetPath;
};

const readAssetReferences = (html) => {
  const references = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    if (/^<script\b/i.test(tag) || /rel=["']modulepreload["']/i.test(tag)) {
      references.push(match[1]);
    }
  }
  return references;
};

const toSafeAsset = (reference) => {
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const assetsMatch = withoutQuery.match(/^(?:\/|\.\/)?assets\/([^/]+)$/);
  const assetName = assetsMatch?.[1];
  if (assetName && SAFE_ASSET_NAME_RE.test(assetName)) {
    return { kind: "bundled", assetName };
  }
  const rootMatch = withoutQuery.match(/^\/([^/]+)$/);
  const rootName = rootMatch?.[1];
  if (rootName && SAFE_ASSET_NAME_RE.test(rootName) && ALLOWED_STATIC_ROOT_SCRIPTS.has(rootName)) {
    return { kind: "static", assetName: rootName };
  }
  throw new Error(`unsafe initial asset reference: ${reference}`);
};

const readModuleMap = (moduleMapPath) => {
  try {
    return JSON.parse(readFileSync(moduleMapPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
};

export const measureInitialLoad = ({
  htmlPath = resolve("dist/index.html"),
  assetsDir = resolve("dist/assets"),
  moduleMapPath = resolve("artifacts/initial-module-map.json"),
} = {}) => {
  const html = readFileSync(htmlPath, "utf8");
  const resolvedAssets = readAssetReferences(html).map(toSafeAsset);
  const assetKindByName = new Map(resolvedAssets.map((asset) => [asset.assetName, asset.kind]));
  const assets = [...assetKindByName.keys()].sort();
  const moduleMap = readModuleMap(moduleMapPath);
  const totals = assets.reduce(
    (result, assetName) => {
      const kind = assetKindByName.get(assetName);
      const assetPath =
        kind === "static"
          ? resolveStaticRootAssetPath(htmlPath, assetName)
          : resolveAssetPath(assetsDir, assetName);
      const bytes = readFileSync(assetPath);
      result.minifiedBytes += statSync(assetPath).size;
      result.gzipBytes += gzipSync(bytes).byteLength;
      return result;
    },
    { minifiedBytes: 0, gzipBytes: 0 }
  );
  const forbiddenModules = assets.flatMap((asset) =>
    (Array.isArray(moduleMap?.[asset]) ? moduleMap[asset] : [])
      .filter((module) => typeof module === "string" && FORBIDDEN_INITIAL_MODULE_RE.test(module))
      .map((module) => ({ asset, module }))
  );
  return { assets, ...totals, forbiddenModules, moduleMapPresent: moduleMap !== null };
};

export const shouldFailInitialLoad = (result, { reportOnly = false } = {}) =>
  !reportOnly && (
    result.minifiedBytes > MAX_INITIAL_MINIFIED_BYTES ||
    result.gzipBytes > MAX_INITIAL_GZIP_BYTES ||
    !result.moduleMapPresent ||
    result.forbiddenModules.length > 0
  );

const run = () => {
  const reportOnly = process.argv.includes("--report-only");
  const result = measureInitialLoad();
  console.log("[perf] Initial JavaScript closure", result);
  if (shouldFailInitialLoad(result, { reportOnly })) {
    console.error("[perf] Initial JavaScript budget failed", {
      maxMinifiedBytes: MAX_INITIAL_MINIFIED_BYTES,
      maxGzipBytes: MAX_INITIAL_GZIP_BYTES,
    });
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
