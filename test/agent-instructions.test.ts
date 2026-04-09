import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAgentInstructions } from "../src/agents/shared-prompt.js";

describe("getAgentInstructions", () => {
  it("includes Permissions section by default", () => {
    const result = getAgentInstructions("test-task-id");
    assert.match(result, /## Permissions/);
    assert.match(result, /PALMIER_PERMISSION/);
  });

  it("strips Permissions section when skipPermissions is true", () => {
    const result = getAgentInstructions("test-task-id", true);
    assert.doesNotMatch(result, /## Permissions/);
    assert.doesNotMatch(result, /PALMIER_PERMISSION/);
  });

  it("preserves other sections when Permissions is stripped", () => {
    const result = getAgentInstructions("test-task-id", true);
    assert.match(result, /## Reporting Output/);
    assert.match(result, /## Completion/);
    assert.match(result, /## HTTP Endpoints/);
  });

  it("replaces template variables", () => {
    const result = getAgentInstructions("my-task-123");
    assert.match(result, /my-task-123/);
    assert.doesNotMatch(result, /\{\{TASK_ID\}\}/);
    assert.doesNotMatch(result, /\{\{PORT\}\}/);
  });
});
