import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const AUTHENTICATED_ONLY_SELECTORS = [
  ".admin-grid",
  ".admin-card",
  ".admin-shell",
  ".admin-hero",
  ".admin-toolbar",
  ".admin-summary-grid",
  ".admin-section-card",
  ".table-wrap",
  ".skeleton-loader-table",
  ".checkout-item-row",
  ".gear-notes-cell",
  ".gear-notes-input",
];

const SAFE_CSS_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*\.css$/;
const LINK_TAG_RE = /<link\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const ATTRIBUTE_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const parseAttributes = (tag) => {
  const attributes = new Map();
  const source = tag.slice(5, -1);
  for (const match of source.matchAll(ATTRIBUTE_RE)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
};

const linkedStylesheets = (html) => {
  const references = [];
  for (const match of html.matchAll(LINK_TAG_RE)) {
    const attributes = parseAttributes(match[0]);
    const relTokens = (attributes.get("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!relTokens.includes("stylesheet")) continue;

    const reference = attributes.get("href") ?? "";
    const path = reference.split(/[?#]/, 1)[0];
    if (!/\.css$/i.test(path)) continue;
    references.push(reference);
  }
  return references;
};

const assetFromReference = (reference) => {
  const cleanReference = reference.split(/[?#]/, 1)[0];
  const match = cleanReference.match(/^(?:\/|\.\/)?assets\/([^/]+)$/);
  const asset = match?.[1] ?? "";
  if (!SAFE_CSS_RE.test(asset)) {
    throw new Error(`unsafe CSS asset reference: ${reference}`);
  }
  return asset;
};

const stripCommentsAndStrings = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");

const containsSelector = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?![A-Za-z0-9_-])`).test(css);
};

export const inspectPublicCss = ({
  htmlPath = resolve("dist/index.html"),
  assetsDir = resolve("dist/assets"),
} = {}) => {
  const html = readFileSync(htmlPath, "utf8");
  const assets = [...new Set(linkedStylesheets(html).map(assetFromReference))].sort(compareText);
  const canonicalAssetsDir = realpathSync(assetsDir);
  const violations = [];

  for (const asset of assets) {
    const assetPath = realpathSync(resolve(canonicalAssetsDir, asset));
    if (dirname(assetPath) !== canonicalAssetsDir) {
      throw new Error(`unsafe CSS asset path: ${asset}`);
    }
    const css = stripCommentsAndStrings(readFileSync(assetPath, "utf8"));
    for (const selector of AUTHENTICATED_ONLY_SELECTORS) {
      if (containsSelector(css, selector)) violations.push({ asset, selector });
    }
  }

  violations.sort(
    (left, right) => compareText(left.asset, right.asset) || compareText(left.selector, right.selector),
  );
  return { assets, violations };
};

const run = () => {
  try {
    const result = inspectPublicCss();
    if (result.violations.length > 0) {
      console.error("[perf] Authenticated selectors found in public entry CSS");
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log("[perf] Public CSS boundary passed");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[perf] Public CSS boundary failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
