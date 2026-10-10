import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTaskOutcome, parsePermissions, parseAgentModel } from "../src/commands/run.js";

describe("parseTaskOutcome", () => {
  it("returns 'finished' for success marker", () => {
    assert.equal(parseTaskOutcome("some output\n[PALMIER_TASK_SUCCESS]"), "finished");
  });

  it("returns 'failed' for failure marker", () => {
    assert.equal(parseTaskOutcome("some output\n[PALMIER_TASK_FAILURE]"), "failed");
  });

  it("returns 'finished' when no marker is present", () => {
    assert.equal(parseTaskOutcome("just some regular output"), "finished");
  });

  it("returns 'failed' when both markers present (failure takes priority)", () => {
    assert.equal(parseTaskOutcome("[PALMIER_TASK_SUCCESS]\n[PALMIER_TASK_FAILURE]"), "failed");
  });

  it("only looks at last 500 chars", () => {
    const padding = "x".repeat(600);
    assert.equal(parseTaskOutcome("[PALMIER_TASK_FAILURE]" + padding), "finished");
  });
});

describe("parsePermissions", () => {
  it("extracts permissions with name and description", () => {
    const output = "[PALMIER_PERMISSION] Read | Read file contents\n[PALMIER_PERMISSION] Bash(npm test) | Run tests";
    const perms = parsePermissions(output);
    assert.equal(perms.length, 2);
    assert.deepEqual(perms[0], { name: "Read", description: "Read file contents" });
    assert.deepEqual(perms[1], { name: "Bash(npm test)", description: "Run tests" });
  });

  it("handles permission without description", () => {
    const perms = parsePermissions("[PALMIER_PERMISSION] Write");
    assert.deepEqual(perms, [{ name: "Write", description: "" }]);
  });

  it("returns empty array when no permissions", () => {
    assert.deepEqual(parsePermissions("no permissions"), []);
  });

  it("ignores placeholder examples from echoed prompt", () => {
    const output = "[PALMIER_PERMISSION] <tool_name> | <description>\n[PALMIER_PERMISSION] Read | Read files";
    const perms = parsePermissions(output);
    assert.equal(perms.length, 1);
    assert.deepEqual(perms[0], { name: "Read", description: "Read files" });
  });
});

describe("parseAgentModel", () => {
  it("extracts the model from its own line", () => {
    assert.equal(parseAgentModel("[PALMIER_AGENT_MODEL] claude-opus-5-5\r\nHello"), "claude-opus-5-5");
  });

  it("ignores the placeholder echoed from the prompt", () => {
    assert.equal(parseAgentModel("[PALMIER_AGENT_MODEL] <model>\n[PALMIER_AGENT_MODEL] GPT-6"), "GPT-6");
  });

  it("rejects values that would break the run-file comment", () => {
    assert.equal(parseAgentModel("[PALMIER_AGENT_MODEL] x --> y"), undefined);
  });

  it("returns undefined when the marker is absent or not at line start", () => {
    assert.equal(parseAgentModel("I am [PALMIER_AGENT_MODEL] foo"), undefined);
  });
});
