// Komari 1.5 removed the v1 REST endpoint for exec results, but komari-zig-agent
// (up to at least v0.1.52) still posts every result there and gets 404. This module
// reshapes that single request into the v2 JSON-RPC call Komari still accepts.
// Authentication is left to Komari: the original query string (token) and headers
// are forwarded untouched, so an agent can only store results for itself.
export const LEGACY_TASK_RESULT_PATH = "/api/clients/task/result";
export const LEGACY_TASK_RESULT_MATCHER = `POST ${LEGACY_TASK_RESULT_PATH}`;
export const V2_RPC_PATH = "/api/clients/v2/rpc";
export const V2_TASK_RESULT_METHOD = "agent.taskResult";
export const V2_TASK_RESULT_ID = "onani-legacy-task-result";
// zig-agent caps command output at 4 MiB; the hook runs before authentication, so
// refuse anything larger before parsing it on the plugin event loop.
export const MAX_LEGACY_BODY_CHARS = 8 * 1024 * 1024;
const MAX_TASK_ID_LENGTH = 256;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type LegacyTaskResultRewrite =
  | { ok: true; url: string; body: string }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Go's time.Time only accepts strict RFC3339; re-serialise so a valid agent timestamp
// can never make Komari reject the whole result. Unusable values fall back to the
// server time, matching the removed v1 handler.
export function normalizeFinishedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !RFC3339.test(value)) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < 0 || time >= Date.UTC(10000, 0, 1)) return undefined;
  return new Date(time).toISOString();
}

export function rewriteLegacyTaskResult(requestUri: string, body: string): LegacyTaskResultRewrite {
  const queryAt = requestUri.indexOf("?");
  const path = queryAt === -1 ? requestUri : requestUri.slice(0, queryAt);
  if (path.toLowerCase() !== LEGACY_TASK_RESULT_PATH) return { ok: false, reason: "请求路径不是旧版任务回传接口" };
  if (body.length > MAX_LEGACY_BODY_CHARS) return { ok: false, reason: "请求体超过 8 MiB" };

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, reason: "请求体不是 JSON" };
  }
  if (!isRecord(payload)) return { ok: false, reason: "请求体不是 JSON 对象" };

  // Same fields and zero values as the removed v1 handler (task_id, result, exit_code).
  const { task_id: taskId, result, exit_code: exitCode } = payload;
  if (typeof taskId !== "string" || taskId.length === 0 || taskId.length > MAX_TASK_ID_LENGTH) {
    return { ok: false, reason: "task_id 无效" };
  }
  if (result !== undefined && typeof result !== "string") return { ok: false, reason: "result 不是字符串" };
  if (exitCode !== undefined && !Number.isSafeInteger(exitCode)) return { ok: false, reason: "exit_code 不是整数" };

  const params: Record<string, unknown> = { task_id: taskId, result: result ?? "", exit_code: exitCode ?? 0 };
  const finishedAt = normalizeFinishedAt(payload.finished_at);
  if (finishedAt) params.finished_at = finishedAt;

  return {
    ok: true,
    url: V2_RPC_PATH + (queryAt === -1 ? "" : requestUri.slice(queryAt)),
    body: JSON.stringify({ jsonrpc: "2.0", method: V2_TASK_RESULT_METHOD, params, id: V2_TASK_RESULT_ID }),
  };
}
