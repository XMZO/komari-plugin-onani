import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanDist, createUpdateCatalog } from "../scripts/release-assets";

test("release catalog points only to the immutable versioned GitHub asset", () => {
  const digest = "a".repeat(64);
  const catalog = createUpdateCatalog({
    name: { "zh-CN": "Onani 工具箱", en: "Onani Toolbox" },
    short: "onani",
    description: { "zh-CN": "测试", en: "Test" },
    version: "1.2.3",
    author: "XMZO",
    url: "https://github.com/XMZO/komari-plugin-onani",
    komari: ">=1.4.3",
  }, digest);

  assert.equal(catalog.schema, 1);
  assert.equal(catalog.plugins.length, 1);
  assert.deepEqual(catalog.plugins[0], {
    name: { "zh-CN": "Onani 工具箱", en: "Onani Toolbox" },
    short: "onani",
    description: { "zh-CN": "测试", en: "Test" },
    version: "1.2.3",
    author: "XMZO",
    url: "https://github.com/XMZO/komari-plugin-onani",
    download: "https://github.com/XMZO/komari-plugin-onani/releases/download/v1.2.3/onani-1.2.3.zip",
    sha256: digest,
    komari: ">=1.4.3",
  });
});

test("dist cleanup removes stale release files without touching sibling files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onani-release-"));
  try {
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "onani-0.1.0.zip"), "old");
    fs.writeFileSync(path.join(root, "keep.txt"), "keep");
    const dist = cleanDist(root);

    assert.deepEqual(fs.readdirSync(dist), []);
    assert.equal(fs.readFileSync(path.join(root, "keep.txt"), "utf8"), "keep");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
