import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PUBLIC_PRERENDER_PAGES,
  applyPublicMetadata,
  injectPublicFallback,
  renderPublicFallback,
} from "./prerender-public.mjs";

const byPath = (path) => {
  const page = PUBLIC_PRERENDER_PAGES.find((candidate) => candidate.path === path);
  if (!page) throw new Error(`Missing prerender definition for ${path}`);
  return page;
};

const textLength = (html) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;

const sourceIndexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sourceMainTs = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const sourcePrerender = readFileSync(new URL("./prerender-public.mjs", import.meta.url), "utf8");

test("defines the public trust and discovery routes", () => {
  assert.deepEqual(
    PUBLIC_PRERENDER_PAGES.map((page) => page.path).filter((path) =>
      [
        "/",
        "/about",
        "/contact",
        "/privacy",
        "/security",
        "/trust",
        "/faq",
        "/getting-started",
      ].includes(path),
    ),
    [
      "/",
      "/about",
      "/contact",
      "/privacy",
      "/security",
      "/trust",
      "/faq",
      "/getting-started",
    ],
  );
});

test("keeps meaningful H1 content above the crawler threshold", () => {
  for (const path of ["/", "/about", "/contact", "/privacy", "/security", "/trust"]) {
    const html = renderPublicFallback(byPath(path));
    assert.match(html, /<h1>/);
    assert.ok(textLength(html) > 500, `${path} should contain more than 500 readable characters`);
  }
});

test("preserves every pricing paragraph in the prerendered fallback", () => {
  const pricingStart = sourcePrerender.indexOf('path: "/pricing"');
  const nextPageStart = sourcePrerender.indexOf('path: "/legal"', pricingStart);
  assert.ok(pricingStart >= 0, "the pricing prerender definition should exist");
  assert.ok(nextPageStart > pricingStart, "the pricing prerender definition should be bounded");

  const pricingSource = sourcePrerender.slice(pricingStart, nextPageStart);
  assert.equal(
    (pricingSource.match(/^\s+paragraphs:\s*\[/gm) ?? []).length,
    1,
    "the pricing page should define one paragraphs key",
  );

  const pricingPage = byPath("/pricing");
  const html = renderPublicFallback(pricingPage);
  for (const phrase of [
    "ItemTraxx publishes plan categories",
    "Workspace plans are intended",
    "Contact Sales for current pricing",
  ]) {
    assert.ok(html.includes(phrase), `pricing fallback should include: ${phrase}`);
  }
});

test("replaces the app shell while preserving built scripts", () => {
  const source = `<!doctype html><html><head><title>Old</title><meta name="description" content="old" /><link rel="canonical" href="https://itemtraxx.com/" /><meta property="og:title" content="Old" /><meta property="og:description" content="old" /><meta property="og:url" content="https://itemtraxx.com/" /><meta name="twitter:title" content="Old" /><meta name="twitter:description" content="old" /></head><body><div id="app"></div><script type="module" src="/assets/index.js"></script></body></html>`;
  const output = injectPublicFallback(source, byPath("/about"));

  assert.match(output, /data-agent-prerendered="true"/);
  assert.match(output, /<h1>The people and thinking behind ItemTraxx\.<\/h1>/);
  assert.match(output, /src="\/assets\/index\.js"/);
  assert.match(output, /<title>About \| ItemTraxx<\/title>/);
  assert.match(output, /href="https:\/\/itemtraxx\.com\/about"/);
  assert.doesNotMatch(output, /<div id="app"><\/div>/);
});

test("updates route metadata without changing the global identity schema", () => {
  const source = `<title>ItemTraxx Inventory Tracking</title><meta name="description" content="old" /><link rel="canonical" href="https://itemtraxx.com/" /><meta property="og:title" content="old" /><meta property="og:description" content="old" /><meta property="og:url" content="https://itemtraxx.com/" /><meta name="twitter:title" content="old" /><meta name="twitter:description" content="old" />`;
  const output = applyPublicMetadata(source, byPath("/privacy"));

  assert.match(output, /<title>Privacy \| ItemTraxx<\/title>/);
  assert.match(output, /content="https:\/\/itemtraxx\.com\/privacy"/);
  assert.doesNotMatch(output, /content="old"/);
});

test("publishes machine-readable identity descriptions", () => {
  assert.match(sourceIndexHtml, /"@type": "Organization"[\s\S]*"description":/);
  assert.match(sourceIndexHtml, /"@type": "WebSite"[\s\S]*"description":/);
});

test("keeps the fallback available while preventing a normal-load flash", () => {
  assert.match(sourceIndexHtml, /\.agent-readable-fallback\s*\{[\s\S]*opacity:\s*0;[\s\S]*visibility:\s*hidden;/);
  assert.match(sourceIndexHtml, /data-itemtraxx-fallback-state="pending"/);
  assert.match(sourceIndexHtml, /data-itemtraxx-fallback-state="slow"/);
  assert.match(sourceIndexHtml, /data-itemtraxx-app-mounted="true"/);
  assert.match(sourceIndexHtml, /effectiveType/);
  assert.match(sourceIndexHtml, /isSlowConnection/);
  assert.match(sourceIndexHtml, /isSlowConnection \? 400 : 3000/);

  const mountIndex = sourceMainTs.indexOf('app.mount("#app");');
  const markerIndex = sourceMainTs.indexOf("markAgentFallbackMounted();", mountIndex);
  assert.ok(mountIndex >= 0, "main.ts should mount the app");
  assert.ok(markerIndex > mountIndex, "main.ts should settle the fallback after mounting Vue");
});
