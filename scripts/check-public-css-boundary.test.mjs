import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectPublicCss } from "./check-public-css-boundary.mjs";

const withFixture = ({ assets = {}, html }, inspect) => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-css-boundary-"));
  const assetsDir = join(root, "assets");
  mkdirSync(assetsDir);
  writeFileSync(join(root, "index.html"), html);
  for (const [asset, css] of Object.entries(assets)) {
    writeFileSync(join(assetsDir, asset), css);
  }

  try {
    return inspect({ htmlPath: join(root, "index.html"), assetsDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("reports authenticated selectors in entry-linked CSS", () => {
  const result = withFixture(
    {
      html: '<link rel="stylesheet" href="/assets/index-a.css">',
      assets: {
        "index-a.css": ":root{color-scheme:light}.admin-grid{display:grid}",
      },
    },
    inspectPublicCss,
  );

  assert.deepEqual(result, {
    assets: ["index-a.css"],
    violations: [{ asset: "index-a.css", selector: ".admin-grid" }],
  });
});

test("accepts public-only entry CSS", () => {
  const result = withFixture(
    {
      html: '<link rel="stylesheet" href="assets/index-a.css">',
      assets: {
        "index-a.css":
          ':root{color-scheme:light}.button-primary{display:block}/* .admin-grid{} */.admin-gridish{content:".admin-card"}',
      },
    },
    inspectPublicCss,
  );

  assert.deepEqual(result, { assets: ["index-a.css"], violations: [] });
});

test("parses either attribute order, rel token lists, and case-insensitive markup", () => {
  const result = withFixture(
    {
      html: [
        '<link href="/assets/first.css" media="screen" rel="preload stylesheet">',
        "<LINK REL='StyleSheet alternate' HREF='./assets/second.css'>",
        '<link rel="preload" href="/assets/not-linked.css">',
      ].join(""),
      assets: {
        "first.css": ".admin-card{display:block}",
        "second.css": ".admin-shell{display:block}",
      },
    },
    inspectPublicCss,
  );

  assert.deepEqual(result, {
    assets: ["first.css", "second.css"],
    violations: [
      { asset: "first.css", selector: ".admin-card" },
      { asset: "second.css", selector: ".admin-shell" },
    ],
  });
});

test("strips query and fragment suffixes and de-duplicates linked assets", () => {
  const result = withFixture(
    {
      html: [
        '<link rel="stylesheet" href="/assets/index-a.css?v=123#theme">',
        '<link href="assets/index-a.css#duplicate" rel="stylesheet">',
      ].join(""),
      assets: { "index-a.css": ".admin-toolbar{display:flex}" },
    },
    inspectPublicCss,
  );

  assert.deepEqual(result, {
    assets: ["index-a.css"],
    violations: [{ asset: "index-a.css", selector: ".admin-toolbar" }],
  });
});

test("ignores stylesheet services without a CSS asset path", () => {
  const result = withFixture(
    {
      html: [
        '<link rel="stylesheet" href="https://fonts.example.com/css2?family=Inter">',
        '<link rel="stylesheet" href="/assets/index-a.css">',
      ].join(""),
      assets: { "index-a.css": ".admin-hero{display:block}" },
    },
    inspectPublicCss,
  );

  assert.deepEqual(result, {
    assets: ["index-a.css"],
    violations: [{ asset: "index-a.css", selector: ".admin-hero" }],
  });
});

for (const href of [
  "../assets/index.css",
  "/assets/../secret.css",
  "/assets/nested/index.css",
  "https://cdn.example.com/assets/index.css",
  "//cdn.example.com/assets/index.css",
  "/assets/%2e%2e%2fsecret.css",
  "/assets/-unsafe.css",
]) {
  test(`rejects unsafe stylesheet reference ${href}`, () => {
    assert.throws(
      () =>
        withFixture(
          { html: `<link rel="stylesheet" href="${href}">` },
          inspectPublicCss,
        ),
      /unsafe CSS asset reference/,
    );
  });
}

test("rejects a safe-named asset symlink that resolves outside the assets directory", () => {
  const root = mkdtempSync(join(tmpdir(), "itemtraxx-css-boundary-"));
  const assetsDir = join(root, "assets");
  const outsideCss = join(root, "outside.css");
  mkdirSync(assetsDir);
  writeFileSync(join(root, "index.html"), '<link rel="stylesheet" href="/assets/index.css">');
  writeFileSync(outsideCss, ".admin-grid{}");
  symlinkSync(outsideCss, join(assetsDir, "index.css"));

  try {
    assert.throws(
      () => inspectPublicCss({ htmlPath: join(root, "index.html"), assetsDir }),
      /unsafe CSS asset path/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sorts assets and violations deterministically", () => {
  const result = withFixture(
    {
      html: [
        '<link rel="stylesheet" href="/assets/z.css">',
        '<link rel="stylesheet" href="/assets/a.css">',
      ].join(""),
      assets: {
        "z.css": ".table-wrap{}.admin-card{}",
        "a.css": ".checkout-item-row{}.admin-grid{}",
      },
    },
    inspectPublicCss,
  );

  assert.deepEqual(result, {
    assets: ["a.css", "z.css"],
    violations: [
      { asset: "a.css", selector: ".admin-grid" },
      { asset: "a.css", selector: ".checkout-item-row" },
      { asset: "z.css", selector: ".admin-card" },
      { asset: "z.css", selector: ".table-wrap" },
    ],
  });
});
