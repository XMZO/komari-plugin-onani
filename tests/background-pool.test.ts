import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundPool } from "../src/features/background/pool";
import { resolveBackgroundConfig, type ImageMetadata } from "../src/features/background/core";

const config = resolveBackgroundConfig({ background_enabled: true, background_webp: true });
function image(index: number, now: number): ImageMetadata {
  return { id: index.toString(16).padStart(64, "0"), originalMime: "image/png", previewMime: "image/webp", extension: "png", originalBytes: 1000, previewBytes: 500, expiresAt: now + 86_400_000, webp: true };
}
function fixture() {
  let now = 1_000_000, count = 0, saved: unknown = null;
  const disk = new Map<string, ImageMetadata>();
  let create = async () => { const value = image(++count, now); disk.set(value.id, value); return value; };
  const dependencies = { create: () => create(), read: (id: string) => disk.get(id) ?? null, load: () => saved,
    save: (value: unknown) => { saved = value; }, error: () => {}, now: () => now };
  return { pool: new BackgroundPool(dependencies), dependencies, disk, count: () => count,
    advance: (ms: number) => { now += ms; }, create: (fn: typeof create) => { create = fn; } };
}

test("prepared pool serves immediately while next source image is stalled", async () => {
  const f = fixture();
  await f.pool.warm(config);
  assert.equal(f.count(), 3);
  f.advance(31_000);
  let finish!: (image: ImageMetadata) => void;
  f.create(() => new Promise((resolve) => { finish = resolve; }));
  const first = await f.pool.get(config);
  assert.ok(f.disk.has(first.id));
  assert.equal(f.pool.running, true);
  const second = await f.pool.get(config);
  assert.notEqual(second.id, first.id);
  finish(image(4, 1_031_000));
});

test("restart restores matching pool without downloading or transcoding", async () => {
  const f = fixture();
  await f.pool.warm(config);
  const restored = new BackgroundPool(f.dependencies);
  // Allow one optional background refill; the returned image must already exist.
  f.create(async () => { throw new Error("source offline"); });
  const result = await restored.get(config);
  assert.ok(f.disk.has(result.id));
});

test("cold concurrent requests share one source job", async () => {
  const f = fixture();
  let calls = 0, finish!: (value: ImageMetadata) => void;
  f.create(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const first = f.pool.get(config), second = f.pool.get(config);
  assert.equal(calls, 1);
  finish(image(10, 1_000_000));
  assert.equal((await first).id, (await second).id);
});

test("changing source cannot select images from the old configuration", async () => {
  const f = fixture();
  await f.pool.warm(config);
  const oldIds = [...f.disk.keys()];
  const changed = await f.pool.get({ ...config, source: "https://another.example/image" });
  assert.ok(!oldIds.includes(changed.id));
});

test("expired or evicted files are removed from selection and refreshed", async () => {
  const f = fixture();
  await f.pool.warm(config);
  const oldIds = [...f.disk.keys()];
  f.disk.clear();
  const next = await f.pool.get(config);
  assert.ok(!oldIds.includes(next.id));
  f.advance(86_400_001);
  assert.notEqual((await f.pool.get(config)).id, next.id);
});

test("repeated visits do not turn into unlimited background source fetches", async () => {
  const f = fixture();
  await f.pool.warm(config);
  for (let i = 0; i < 50; i++) await f.pool.get(config);
  assert.equal(f.count(), 3);
  f.advance(31_000);
  await f.pool.get(config);
  await Promise.resolve();
  assert.equal(f.count(), 4);
});
