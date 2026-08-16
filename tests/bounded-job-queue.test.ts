import assert from "node:assert/strict";
import test from "node:test";

import { BoundedJobQueue } from "../src/shared/bounded-job-queue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("bounded queue keeps FIFO order and never exceeds its concurrency limit", async () => {
  const gates = Array.from({ length: 6 }, deferred);
  const started: number[] = [];
  let running = 0;
  let peak = 0;
  const queue = new BoundedJobQueue<number>(4, async (item) => {
    started.push(item);
    running += 1;
    peak = Math.max(peak, running);
    await gates[item].promise;
    running -= 1;
  });

  for (let item = 0; item < gates.length; item += 1) queue.enqueue(item);
  await nextTurn();
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.deepEqual(queue.snapshot(), { active: 4, pending: 2, total: 6 });

  gates[1].resolve();
  await nextTurn();
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.equal(peak, 4);

  for (const gate of gates) gate.resolve();
  await nextTurn();
  await nextTurn();
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(queue.snapshot(), { active: 0, pending: 0, total: 0 });
});

test("a failed job releases its slot and reports the error", async () => {
  const errors: Array<{ error: unknown; item: number }> = [];
  const completed: number[] = [];
  const queue = new BoundedJobQueue<number>(1, async (item) => {
    if (item === 1) throw new Error("expected failure");
    completed.push(item);
  }, undefined, (error, item) => errors.push({ error, item }));

  queue.enqueue(1);
  queue.enqueue(2);
  await nextTurn();
  await nextTurn();

  assert.deepEqual(completed, [2]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].item, 1);
  assert.match(String(errors[0].error), /expected failure/);
  assert.equal(queue.size, 0);
});
