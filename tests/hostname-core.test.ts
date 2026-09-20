import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CACHE_DAYS,
  safeResultOutput,
  safeErrorText,
  normalizeHostname,
  normalizeHostnameCache,
  normalizeUuidList,
  resolveHostnameConfig,
  shouldRefreshHostname,
} from "../src/features/hostname/core";

test("configuration uses safe defaults and clamps invalid cache lifetimes", () => {
  assert.deepEqual(resolveHostnameConfig({}), {
    enabled: true,
    autoRefresh: true,
    cacheDays: DEFAULT_CACHE_DAYS,
    cacheTtlMs: DEFAULT_CACHE_DAYS * 86_400_000,
  });
  assert.equal(resolveHostnameConfig({ hostname_cache_days: 0 }).cacheDays, DEFAULT_CACHE_DAYS);
  assert.equal(resolveHostnameConfig({ hostname_cache_days: 3651 }).cacheDays, DEFAULT_CACHE_DAYS);
  assert.equal(resolveHostnameConfig({ hostname_cache_days: "45" }).cacheDays, 45);
  assert.equal(resolveHostnameConfig({ hostname_enabled: false }).enabled, false);
});

test("hostname output accepts one safe line and rejects ambiguous or unsafe output", () => {
  assert.deepEqual(normalizeHostname("web-01.example\r\n"), { ok: true, hostname: "web-01.example" });
  assert.deepEqual(normalizeHostname("东京-01\n"), { ok: true, hostname: "东京-01" });
  assert.equal(normalizeHostname("first\nsecond\n").ok, false);
  assert.equal(normalizeHostname("<script>").ok, false);
  assert.equal(normalizeHostname("   \n").ok, false);
});

test("fresh values are cached while failed or stale values respect the retry backoff", () => {
  const now = Date.parse("2026-08-17T00:00:00.000Z");
  const day = 86_400_000;
  assert.equal(
    shouldRefreshHostname({ hostname: "node-a", collected_at: new Date(now - day).toISOString() }, now, 30 * day),
    false,
  );
  assert.equal(
    shouldRefreshHostname({ hostname: "node-a", collected_at: new Date(now - 31 * day).toISOString() }, now, 30 * day),
    true,
  );
  assert.equal(
    shouldRefreshHostname({ last_attempt_at: new Date(now - 2 * 60 * 60 * 1000).toISOString() }, now, 30 * day),
    false,
  );
  assert.equal(
    shouldRefreshHostname({ last_attempt_at: new Date(now - 25 * 60 * 60 * 1000).toISOString() }, now, 30 * day),
    true,
  );
});

test("cache and UUID inputs are normalized before use", () => {
  const uuid = "F9E79538-E4A8-43B2-8E58-A1857C82CC5F";
  assert.deepEqual(normalizeUuidList([uuid, uuid.toLowerCase(), "invalid"]), [uuid.toLowerCase()]);

  const cache = normalizeHostnameCache({
    schema: 1,
    updated_at: "2026-08-17T00:00:00.000Z",
    entries: {
      [uuid]: {
        hostname: "  node-a\r\n",
        collected_at: "2026-08-16T00:00:00.000Z",
        last_error: " bad\n error ",
      },
      invalid: { hostname: "must-be-ignored" },
    },
  });
  assert.deepEqual(Object.keys(cache.entries), [uuid.toLowerCase()]);
  assert.equal(cache.entries[uuid.toLowerCase()].hostname, "node-a");
  assert.equal(cache.entries[uuid.toLowerCase()].last_error, "bad error");
});


test("failure diagnostics survive cache reload with bounded output and real error codes", () => {
  const uuid = "f9e79538-e4a8-43b2-8e58-a1857c82cc5f";
  const failure = { stage: "Agent 执行 hostname", at: "2026-09-20T01:00:00.000Z", task_id: "task-123", rpc_code: -32044, exit_code: 0, output: "first\nsecond" };
  const cache = normalizeHostnameCache({ schema: 1, entries: { [uuid]: { last_error: "Agent 返回了多行结果", last_failure: failure } } });
  assert.deepEqual(cache.entries[uuid].last_failure, failure);
  assert.equal(safeResultOutput("\u001b[31mfailed\u001b[0m\nreason\u0000"), "failed\nreason");
  assert.equal(safeResultOutput("x".repeat(3000)).length, 2048);
  assert.equal(safeErrorText({ code: -32000, message: "RPC unavailable" }), "RPC unavailable");
});
