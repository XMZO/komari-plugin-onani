import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_TASK_RESULT_MATCHER,
  MAX_LEGACY_BODY_CHARS,
  normalizeFinishedAt,
  rewriteLegacyTaskResult,
  V2_TASK_RESULT_ID,
} from "../src/features/agent-compat/core";

const LEGACY_URI = "/api/clients/task/result?token=a%2Bb%3D&x=1";

function rewritten(body: unknown, uri = LEGACY_URI) {
  const result = rewriteLegacyTaskResult(uri, typeof body === "string" ? body : JSON.stringify(body));
  if (!result.ok) throw new Error(`expected rewrite: ${result.reason}`);
  return { url: result.url, rpc: JSON.parse(result.body) };
}

test("hook only targets the removed legacy endpoint", () => {
  assert.equal(LEGACY_TASK_RESULT_MATCHER, "POST /api/clients/task/result");
  assert.equal(rewriteLegacyTaskResult("/api/clients/v2/rpc?token=t", '{"task_id":"a"}').ok, false);
  assert.equal(rewriteLegacyTaskResult("/api/clients/task/result/extra", '{"task_id":"a"}').ok, false);
});

test("zig-agent payload becomes a v2 agent.taskResult call with the query preserved verbatim", () => {
  const { url, rpc } = rewritten({ task_id: "ZyIhg2aElyj6kHwP", result: "kazami-kazuki\n", exit_code: 0, finished_at: "2026-10-05T12:48:35Z" });
  assert.equal(url, "/api/clients/v2/rpc?token=a%2Bb%3D&x=1");
  assert.deepEqual(rpc, {
    jsonrpc: "2.0",
    method: "agent.taskResult",
    params: { task_id: "ZyIhg2aElyj6kHwP", result: "kazami-kazuki\n", exit_code: 0, finished_at: "2026-10-05T12:48:35.000Z" },
    id: V2_TASK_RESULT_ID,
  });
  assert.equal(rewritten({ task_id: "t" }, "/api/clients/task/result").url, "/api/clients/v2/rpc");
  assert.equal(rewritten({ task_id: "t" }, "/API/Clients/Task/Result?token=x").url, "/api/clients/v2/rpc?token=x");
});

test("missing fields use the removed v1 handler's zero values and failures keep their exit code", () => {
  assert.deepEqual(rewritten({ task_id: "t" }).rpc.params, { task_id: "t", result: "", exit_code: 0 });
  assert.deepEqual(rewritten({ task_id: "t", result: "Remote control is disabled.", exit_code: -1 }).rpc.params, {
    task_id: "t", result: "Remote control is disabled.", exit_code: -1,
  });
});

test("timestamps Go would reject are dropped instead of losing the result", () => {
  assert.equal(normalizeFinishedAt("2026-10-05T20:48:35+08:00"), "2026-10-05T12:48:35.000Z");
  assert.equal(normalizeFinishedAt("2026-10-05T12:48:35.123456Z"), "2026-10-05T12:48:35.123Z");
  for (const value of ["", "2026-10-05 12:48:35", "2026-10-05T12:48:35", "1759668515", 1759668515, null, "2026-13-45T99:99:99Z"]) {
    assert.equal(normalizeFinishedAt(value), undefined, String(value));
  }
  assert.equal("finished_at" in rewritten({ task_id: "t", finished_at: "yesterday" }).rpc.params, false);
});

test("malformed or oversized bodies are left untouched for Komari to reject", () => {
  const rejected = [
    "",
    "not json",
    "[]",
    "null",
    JSON.stringify({ result: "x" }),
    JSON.stringify({ task_id: "" }),
    JSON.stringify({ task_id: "x".repeat(257) }),
    JSON.stringify({ task_id: 123 }),
    JSON.stringify({ task_id: "t", result: 1 }),
    JSON.stringify({ task_id: "t", exit_code: 1.5 }),
    JSON.stringify({ task_id: "t", exit_code: "0" }),
    JSON.stringify({ task_id: "t", result: "x".repeat(MAX_LEGACY_BODY_CHARS) }),
  ];
  for (const body of rejected) {
    const result = rewriteLegacyTaskResult(LEGACY_URI, body);
    assert.equal(result.ok, false, body.slice(0, 60));
    if (!result.ok) assert.ok(result.reason.length > 0);
  }
});
