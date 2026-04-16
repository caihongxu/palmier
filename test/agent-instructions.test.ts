import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { generateEndpointDocs, type ToolDefinition, type ResourceDefinition } from "../src/mcp-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "..", "src", "agents", "agent-instructions.md");
const template = fs.readFileSync(templatePath, "utf-8");

/** Mock tools with a known, stable shape for testing */
const mockTools: ToolDefinition[] = [
  {
    name: "mock-action",
    description: [
      "Perform a mock action.",
      'Response: `{"ok": true}` on success.',
    ],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Action title" },
        detail: { type: "string", description: "Optional detail" },
      },
      required: ["title"],
    },
    handler: async () => ({ ok: true }),
  },
  {
    name: "mock-query",
    description: [
      "Query mock data from the device.",
      "Blocks until the device responds.",
      'Response: `{"data": ...}` on success.',
    ],
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter tags",
        },
      },
    },
    handler: async () => ({ data: [] }),
  },
];

/** Mock resources with a known, stable shape for testing */
const mockResources: ResourceDefinition[] = [
  {
    uri: "mock://data",
    name: "Mock Data",
    description: [
      "Get mock data from the device.",
      "Response: JSON array of data objects.",
    ],
    mimeType: "application/json",
    restPath: "/mock-data",
    read: () => [],
  },
];

/** Minimal replica of getAgentInstructions that doesn't need host.json */
function buildInstructions(taskId: string, opts?: { skipPermissions?: boolean }): string {
  let instructions = template
    .replace(/\{\{ENDPOINT_DOCS\}\}/g, generateEndpointDocs(9966, taskId, mockTools, mockResources))
    .replace(/\{\{TASK_DESCRIPTION\}\}/g, "Test task prompt");
  if (opts?.skipPermissions) {
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
    const result = buildInstructions("test-task-id", { skipPermissions: true });
    assert.doesNotMatch(result, /## Permissions/);
    assert.doesNotMatch(result, /PALMIER_PERMISSION/);
  });

  it("preserves other sections when Permissions is stripped", () => {
    const result = buildInstructions("test-task-id", { skipPermissions: true });
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


describe("generateEndpointDocs", () => {
  const docs = generateEndpointDocs(9966, "test-id", mockTools, mockResources);

  it("matches expected full output", () => {
    const expected = [
      "The following HTTP endpoints are available during task execution. Use curl to call them.",
      "",
      "**`POST http://localhost:9966/mock-action?taskId=test-id`** — Perform a mock action.",
      "```json",
      '{"title":"...","detail":"..."}',
      "```",
      "- `title` (required, string): Action title",
      "- `detail` (optional, string): Optional detail",
      '- Response: `{"ok": true}` on success.',
      "",
      "**`POST http://localhost:9966/mock-query?taskId=test-id`** — Query mock data from the device.",
      "```json",
      '{"tags":["..."]}',
      "```",
      "- `tags` (optional, string array): Filter tags",
      "- Blocks until the device responds.",
      '- Response: `{"data": ...}` on success.',
      "",
      "**`GET http://localhost:9966/mock-data`** — Get mock data from the device.",
      "- Response: JSON array of data objects.",
    ].join("\n");
    assert.equal(docs, expected);
  });

  it("generates docs for all provided tools", () => {
    for (const tool of mockTools) {
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
    for (const tool of mockTools) {
      if (tool.description.length > 1) {
        assert.match(docs, /Response:/, `Missing response description for ${tool.name}`);
      }
    }
  });

  it("marks required and optional parameters correctly", () => {
    assert.match(docs, /\(required, string\)/);
    // "detail" has no required entry, so it should be optional
    assert.match(docs, /\(optional, string\)/);
  });

  it("handles array-type parameters", () => {
    assert.match(docs, /\(optional, string array\)/);
    assert.match(docs, /Filter tags/);
  });

  it("renders multi-line descriptions as bullet points", () => {
    assert.match(docs, /- Blocks until the device responds\./);
  });

  it("generates GET endpoints for all provided resources", () => {
    for (const resource of mockResources) {
      assert.match(docs, new RegExp(`GET http://localhost:9966${resource.restPath}`), `Missing endpoint for ${resource.uri}`);
    }
  });

  it("includes resource description as bullet points", () => {
    assert.match(docs, /- Response: JSON array of data objects\./);
  });

  it("generates no resource endpoints when resources array is empty", () => {
    const docsNoResources = generateEndpointDocs(9966, "test-id", mockTools, []);
    assert.doesNotMatch(docsNoResources, /GET http/);
  });
});
