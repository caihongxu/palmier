import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { generateEndpointDocs, agentTools } from "../src/mcp-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "..", "src", "agents", "agent-instructions.md");
const template = fs.readFileSync(templatePath, "utf-8");

/** Minimal replica of getAgentInstructions that doesn't need host.json */
function buildInstructions(taskId: string, skipPermissions?: boolean): string {
  let instructions = template
    .replace(/\{\{ENDPOINT_DOCS\}\}/g, generateEndpointDocs(9966, taskId))
    .replace(/\{\{TASK_DESCRIPTION\}\}/g, "Test task prompt");
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

  it("replaces all template variables", () => {
    const result = buildInstructions("my-task-123");
    assert.doesNotMatch(result, /\{\{ENDPOINT_DOCS\}\}/);
    assert.doesNotMatch(result, /\{\{TASK_DESCRIPTION\}\}/);
  });

  it("includes task ID in endpoint examples", () => {
    const result = buildInstructions("my-task-123");
    assert.match(result, /my-task-123/);
  });

  it("includes port in endpoint URL", () => {
    const result = buildInstructions("test");
    assert.match(result, /localhost:9966/);
  });

  it("includes task description", () => {
    const result = buildInstructions("test");
    assert.match(result, /Test task prompt/);
  });
});

describe("full agent instruction snapshot", () => {
  it("matches the expected full text exactly", () => {
    const result = buildInstructions("test-task-id").replace(/\r\n/g, "\n").trimEnd();
    const snapshotPath = path.join(__dirname, "fixtures", "agent-instructions-snapshot.md");
    const expected = fs.readFileSync(snapshotPath, "utf-8").replace(/\r\n/g, "\n").trimEnd();
    assert.equal(result, expected);
  });
});

describe("generateEndpointDocs", () => {
  const docs = generateEndpointDocs(9966, "test-id");

  it("generates docs for all MCP tools", () => {
    for (const tool of agentTools) {
      assert.match(docs, new RegExp(`POST http://localhost:9966/${tool.name}\\?taskId=`), `Missing endpoint for ${tool.name}`);
    }
  });

  it("includes taskId parameter for every endpoint", () => {
    const endpointBlocks = docs.split("**`POST");
    // First element is the header, skip it
    for (let i = 1; i < endpointBlocks.length; i++) {
      assert.match(endpointBlocks[i], /taskId/, `Missing taskId in endpoint block ${i}`);
    }
  });

  it("includes port in the header", () => {
    assert.match(docs, /localhost:9966/);
  });

  it("includes task ID in query parameters", () => {
    assert.match(docs, /taskId=test-id/);
  });

  it("includes response descriptions", () => {
    for (const tool of agentTools) {
      if (tool.responseDescription) {
        assert.match(docs, /Response:/, `Missing response description for ${tool.name}`);
      }
    }
  });

  it("marks required and optional parameters correctly", () => {
    assert.match(docs, /\(required, string\)/);
    assert.match(docs, /\(optional, string\)/);
  });
});
