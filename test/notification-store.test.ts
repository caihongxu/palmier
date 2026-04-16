import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Re-import fresh module state for each test file run
// Since the store is module-level state, we test the exported functions directly
import { addNotification, getNotifications, onNotificationsChanged, type DeviceNotification } from "../src/notification-store.js";

function makeNotification(id: string, overrides?: Partial<DeviceNotification>): DeviceNotification {
  return {
    id,
    packageName: "com.example.app",
    appName: "Example",
    title: `Title ${id}`,
    text: `Text ${id}`,
    timestamp: Date.now(),
    receivedAt: Date.now(),
    ...overrides,
  };
}

describe("notification-store", () => {
  it("stores and retrieves notifications", () => {
    const before = getNotifications().length;
    addNotification(makeNotification("test-1"));
    const after = getNotifications();
    assert.equal(after.length, before + 1);
    assert.equal(after[after.length - 1].id, "test-1");
  });

  it("returns a defensive copy", () => {
    const a = getNotifications();
    const b = getNotifications();
    assert.notStrictEqual(a, b);
  });

  it("evicts oldest when exceeding max", () => {
    const before = getNotifications().length;
    // Add enough to exceed 50
    for (let i = 0; i < 60; i++) {
      addNotification(makeNotification(`evict-${i}`));
    }
    const result = getNotifications();
    assert.ok(result.length <= 50, `Expected <= 50, got ${result.length}`);
  });

  it("notifies listeners on add", () => {
    let called = 0;
    const unsub = onNotificationsChanged(() => { called++; });
    addNotification(makeNotification("listener-1"));
    assert.equal(called, 1);
    addNotification(makeNotification("listener-2"));
    assert.equal(called, 2);
    unsub();
    addNotification(makeNotification("listener-3"));
    assert.equal(called, 2); // no longer called after unsubscribe
  });
});
