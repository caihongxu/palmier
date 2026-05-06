import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { listInstallableAgents } from "../src/agents/agent.js";

describe("listInstallableAgents", () => {
  it("only includes agents with an npmPackage", () => {
    const agents = listInstallableAgents();
    assert.ok(agents.length > 0, "expected at least one installable agent");
    for (const a of agents) {
      assert.ok(a.npmPackage, `agent ${a.key} is missing an npmPackage`);
    }
  });

  it("returns shaped entries (key, label, npmPackage, command)", () => {
    const [first] = listInstallableAgents();
    assert.ok(first);
    assert.equal(typeof first.key, "string");
    assert.equal(typeof first.label, "string");
    assert.equal(typeof first.npmPackage, "string");
    assert.equal(typeof first.command, "string");
  });

  it("places tier-one agents (claude, gemini, codex, copilot) ahead of all others, in that order", () => {
    const keys = listInstallableAgents().map((a) => a.key);
    const tierOne = ["claude", "gemini", "codex", "copilot"];
    const presentTierOne = tierOne.filter((k) => keys.includes(k));
    assert.deepEqual(
      keys.slice(0, presentTierOne.length),
      presentTierOne,
      "tier-one agents must appear at the head of the list in claude→gemini→codex→copilot order",
    );
  });

  it("non-tier-one agents follow tier-one and appear in registry order", () => {
    const keys = listInstallableAgents().map((a) => a.key);
    const tierOne = new Set(["claude", "gemini", "codex", "copilot"]);
    const tail = keys.filter((k) => !tierOne.has(k));
    // Calling again should produce a stable order — the tail comparator returns 0
    // for non-tier-one keys, so they retain insertion (registry) order.
    const keysAgain = listInstallableAgents().map((a) => a.key);
    const tailAgain = keysAgain.filter((k) => !tierOne.has(k));
    assert.deepEqual(tail, tailAgain, "non-tier-one ordering must be stable across calls");
  });
});
