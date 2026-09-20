import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_PATH, originalPath, parseMetadata, parseOriginalPath, resolveBackgroundConfig } from "../src/features/background/core";

test("background features are opt-in with bounded quality and no resizing", () => {
  assert.equal(resolveBackgroundConfig({}).enabled, false);
  assert.equal(resolveBackgroundConfig({}).webp, false);
  assert.equal(resolveBackgroundConfig({ background_enabled: "true" }).enabled, false);
  const c = resolveBackgroundConfig({ background_enabled: true, background_webp: true, background_quality: 1, background_max_edge: 10000 });
  assert.equal(c.enabled, true); assert.equal(c.webp, true);
  assert.equal(c.quality, 40); assert.equal("edge" in c, false);
});

test("proxy only accepts supported sources and immutable original paths", () => {
  for (const source of ["http://t.alcy.cc/ycy/", "https://user@t.alcy.cc/a", "https://t.alcy.cc:444/a", "https://t.alcy.cc/a#x"]) {
    assert.throws(() => resolveBackgroundConfig({ background_source: source }));
  }
  for (const source of ["https://random.example.test/a", "https://cdn.other.example.test/a.webp", "https://t.alcy.cc:443/a"]) {
    assert.equal(resolveBackgroundConfig({ background_source: source }).source, source);
  }
  const id = "a".repeat(64);
  assert.equal(parseOriginalPath(originalPath(id)), id);
  assert.equal(parseOriginalPath(`${originalPath(id)}?download=1`), id);
  for (const path of [`${BACKGROUND_PATH}/../original`, `${BACKGROUND_PATH}/%2e%2e/original`, `${BACKGROUND_PATH}/${id}/preview`, `${BACKGROUND_PATH}/${id}z/original`]) {
    assert.equal(parseOriginalPath(path), null);
  }
});

test("metadata cannot redirect downloads or mislabel the original", () => {
  const data = { id: "a".repeat(64), originalMime: "image/png", previewMime: "image/webp", extension: "png", originalBytes: 1000, previewBytes: 200, expiresAt: Date.now()+10000, webp: true };
  assert.deepEqual(parseMetadata(data), data);
  for (const mutation of [{ id: "../secret" }, { originalMime: "text/html" }, { extension: "html" }, { previewBytes: 1001 }, { originalBytes: 17*1024*1024 }]) {
    assert.throws(() => parseMetadata({ ...data, ...mutation }));
  }
});
