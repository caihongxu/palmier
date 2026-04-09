import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "..", "src", "agents", "agent-instructions.md");
const template = fs.readFileSync(templatePath, "utf-8");

/** Minimal replica of getAgentInstructions that doesn't need host.json */
function buildInstructions(taskId: string, skipPermissions?: boolean): string {
  let instructions = template
    .replace(/\{\{PORT\}\}/g, "7400")
    .replace(/\{\{TASK_ID\}\}/g, taskId);
  if (skipPermissions) {
    instructions = instructions.replace(/## Permissions\r?\n[\s\S]*?(?=## |\r?\n---)/m, "");
  }
  return instructions;
}

describe("getAgentInstructions", () => {
  it("includes Permissions section by default", () => {
    const result = buildInstructions("test-task-id");
    assert.match(result, /## Permissions/);
    assert.match(result, /PALMIER_PERMISSION/);
  });

  it("strips Permissions section when skipPermissions is true", () => {
    const result = buildInstructions("test-task-id", true);
    assert.doesNotMatch(result, /## Permissions/);
    assert.doesNotMatch(result, /PALMIER_PERMISSION/);
  });

  it("preserves other sections when Permissions is stripped", () => {
    const result = buildInstructions("test-task-id", true);
    assert.match(result, /## Reporting Output/);
    assert.match(result, /## Completion/);
    assert.match(result, /## HTTP Endpoints/);
  });

  it("replaces template variables", () => {
    const result = buildInstructions("my-task-123");
    assert.match(result, /my-task-123/);
    assert.doesNotMatch(result, /\{\{TASK_ID\}\}/);
    assert.doesNotMatch(result, /\{\{PORT\}\}/);
  });
});
