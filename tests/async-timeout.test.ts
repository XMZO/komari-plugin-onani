import assert from "node:assert/strict";
import test from "node:test";

import { isOperationTimeout, OperationTimeoutError, withTimeout } from "../src/shared/async-timeout";

test("withTimeout returns a value that settles before its deadline", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 100, "不应超时"), "ok");
});

test("withTimeout rejects a stalled operation with a recognizable error", async () => {
  const stalled = new Promise<never>(() => undefined);
  await assert.rejects(
    withTimeout(stalled, 10, "测试操作超时"),
    (error: unknown) => error instanceof OperationTimeoutError
      && isOperationTimeout(error)
      && error.message === "测试操作超时",
  );
});

test("withTimeout preserves the original rejection", async () => {
  const original = new Error("original failure");
  await assert.rejects(withTimeout(Promise.reject(original), 100, "不应超时"), original);
});
