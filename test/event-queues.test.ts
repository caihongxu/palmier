import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  enqueueEvent,
  popEvent,
  clearTaskQueue,
} from "../src/event-queues.js";

describe("event-queues", () => {
  it("first enqueue on a task signals shouldStart=true", () => {
    const taskId = "task-first-start";
    const result = enqueueEvent(taskId, "evt-1");
    assert.equal(result.shouldStart, true);
    clearTaskQueue(taskId);
  });

  it("subsequent enqueues while a run is active return shouldStart=false", () => {
    const taskId = "task-no-restart";
    enqueueEvent(taskId, "evt-1");
    const second = enqueueEvent(taskId, "evt-2");
    const third = enqueueEvent(taskId, "evt-3");
    assert.equal(second.shouldStart, false);
    assert.equal(third.shouldStart, false);
    clearTaskQueue(taskId);
  });

  it("popEvent returns events in FIFO order", () => {
    const taskId = "task-fifo";
    enqueueEvent(taskId, "a");
    enqueueEvent(taskId, "b");
    enqueueEvent(taskId, "c");

    const r1 = popEvent(taskId);
    const r2 = popEvent(taskId);
    const r3 = popEvent(taskId);
    assert.deepEqual(r1, { event: "a" });
    assert.deepEqual(r2, { event: "b" });
    assert.deepEqual(r3, { event: "c" });
    clearTaskQueue(taskId);
  });

  it("popEvent returns empty when no events queued", () => {
    const taskId = "task-empty";
    const result = popEvent(taskId);
    assert.deepEqual(result, { empty: true });
  });

  it("draining the queue clears active state — next enqueue starts a fresh run", () => {
    const taskId = "task-drain-cycle";
    enqueueEvent(taskId, "a");
    enqueueEvent(taskId, "b");
    popEvent(taskId);            // returns 'a'
    popEvent(taskId);            // returns 'b'
    const drained = popEvent(taskId); // sees the queue empty and releases activeRuns
    assert.deepEqual(drained, { empty: true });
    const next = enqueueEvent(taskId, "c");
    assert.equal(next.shouldStart, true);
    clearTaskQueue(taskId);
  });

  it("evicts oldest when exceeding 100-event limit", () => {
    const taskId = "task-overflow";
    for (let i = 0; i < 105; i++) {
      enqueueEvent(taskId, `evt-${i}`);
    }
    // First 5 should have been evicted; head should be evt-5
    const head = popEvent(taskId);
    assert.deepEqual(head, { event: "evt-5" });

    // Drain the rest and confirm we get exactly 99 more (total 100 in queue)
    let remaining = 0;
    while (true) {
      const r = popEvent(taskId);
      if ("empty" in r) break;
      remaining++;
    }
    assert.equal(remaining, 99);
    clearTaskQueue(taskId);
  });

  it("clearTaskQueue removes both queue and active state", () => {
    const taskId = "task-clear";
    enqueueEvent(taskId, "a");
    clearTaskQueue(taskId);

    // After clear, popEvent reports empty and a new enqueue signals shouldStart=true
    const popped = popEvent(taskId);
    assert.deepEqual(popped, { empty: true });
    const next = enqueueEvent(taskId, "fresh");
    assert.equal(next.shouldStart, true);
    clearTaskQueue(taskId);
  });

  it("queues are isolated per task", () => {
    enqueueEvent("task-A", "a-1");
    const startB = enqueueEvent("task-B", "b-1");
    assert.equal(startB.shouldStart, true, "task-B should start independently of task-A");

    // Popping task-B does not drain task-A
    popEvent("task-B");
    const aHead = popEvent("task-A");
    assert.deepEqual(aHead, { event: "a-1" });
    clearTaskQueue("task-A");
    clearTaskQueue("task-B");
  });
});
