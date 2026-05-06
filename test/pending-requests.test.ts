import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  registerPending,
  resolvePending,
  getPending,
  removePending,
  listPending,
} from "../src/pending-requests.js";

describe("pending-requests", () => {
  it("registerPending returns a promise that resolves via resolvePending", async () => {
    const key = "session-resolve";
    const promise = registerPending(key, "confirmation");
    const ok = resolvePending(key, ["yes"]);
    assert.equal(ok, true);
    const value = await promise;
    assert.deepEqual(value, ["yes"]);
  });

  it("rejects when registering a duplicate key", async () => {
    const key = "session-dup";
    const first = registerPending(key, "confirmation");
    await assert.rejects(
      registerPending(key, "confirmation"),
      /already has a pending request/,
    );
    resolvePending(key, []);
    await first;
  });

  it("resolvePending returns false when key is unknown", () => {
    const ok = resolvePending("never-registered", ["x"]);
    assert.equal(ok, false);
  });

  it("resolvePending removes the entry — same key can be re-registered", async () => {
    const key = "session-reuse";
    const first = registerPending(key, "input");
    resolvePending(key, ["a"]);
    await first;
    // After resolution the slot is free, so a new registration succeeds.
    const second = registerPending(key, "input");
    resolvePending(key, ["b"]);
    assert.deepEqual(await second, ["b"]);
  });

  it("getPending exposes the live entry's type/params/meta", () => {
    const key = "session-inspect";
    const promise = registerPending(
      key,
      "input",
      ["What is your name?"],
      { session_name: "agent-x", description: "input prompt" },
    );
    const entry = getPending(key);
    assert.ok(entry);
    assert.equal(entry!.type, "input");
    assert.deepEqual(entry!.params, ["What is your name?"]);
    assert.equal(entry!.meta?.session_name, "agent-x");
    assert.equal(entry!.meta?.description, "input prompt");
    resolvePending(key, ["done"]);
    return promise.then(() => {
      assert.equal(getPending(key), undefined);
    });
  });

  it("removePending drops an entry without resolving its promise", async () => {
    const key = "session-remove";
    let resolved = false;
    const promise = registerPending(key, "permission").then(() => {
      resolved = true;
    });
    removePending(key);
    assert.equal(getPending(key), undefined);
    // Give the microtask queue a chance — the promise should still be pending.
    await new Promise((r) => setImmediate(r));
    assert.equal(resolved, false);
    void promise; // intentionally never settles
  });

  it("listPending omits the resolve callback and returns the right shape", () => {
    const key = "session-list";
    const promise = registerPending(key, "permission", [], { session_name: "task-1" });
    const all = listPending();
    const entry = all.find((e) => e.key === key);
    assert.ok(entry, "expected our key to appear in listPending output");
    assert.equal(entry!.type, "permission");
    assert.deepEqual(entry!.params, []);
    assert.equal(entry!.meta?.session_name, "task-1");
    // Spread should not leak `resolve` — the field must not appear.
    assert.equal((entry as Record<string, unknown>).resolve, undefined);
    resolvePending(key, []);
    return promise;
  });
});
