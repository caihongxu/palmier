import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateEndpointDocs, type ToolDefinition, type ResourceDefinition } from "../src/agent-tools.js";
import { renderAgentInstructions } from "../src/agents/shared-prompt.js";

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
    name: "Mock Data",
    description: [
      "Get mock data from the device.",
      "Response: JSON array of data objects.",
    ],
    restPath: "/mock-data",
    read: () => [],
  },
];

function buildInstructions(taskId: string, userPrompt?: string, taskDescription = "Test task prompt"): string {
  return renderAgentInstructions({
    endpointDocs: generateEndpointDocs(7256, taskId, mockTools, mockResources),
    userPrompt,
    taskDescription,
  });
}

describe("getAgentInstructions", () => {
  it("includes the standard sections", () => {
    const result = buildInstructions("test-task-id");
    assert.match(result, /## Linking Files/);
    assert.match(result, /## Completion/);
    assert.match(result, /## HTTP Endpoints/);
  });

  it("replaces all template variables", () => {
    const result = buildInstructions("my-task-123");
    assert.doesNotMatch(result, /\{\{ENDPOINT_DOCS\}\}/);
    assert.doesNotMatch(result, /\{\{TASK_DESCRIPTION\}\}/);
    assert.doesNotMatch(result, /\{\{USER_PROMPT\}\}/);
  });

  it("places the user prompt after the endpoints and before the task description", () => {
    const result = buildInstructions("test", "Always reply in French.");
    const endpoints = result.indexOf("## HTTP Endpoints");
    const userPrompt = result.indexOf("Always reply in French.");
    const task = result.indexOf("Test task prompt");
    assert.ok(endpoints < userPrompt && userPrompt < task);
  });

  it("adds no user prompt section when none is set", () => {
    assert.doesNotMatch(buildInstructions("test"), /Standing Instructions/);
  });

  it("keeps replacement patterns and slot names in user text literal", () => {
    const result = buildInstructions("test", "Cost is $& and {{TASK_DESCRIPTION}}", "Pay $1 for {{ENDPOINT_DOCS}}");
    assert.ok(result.includes("Cost is $& and {{TASK_DESCRIPTION}}"));
    assert.ok(result.includes("Pay $1 for {{ENDPOINT_DOCS}}"));
  });

  it("includes task ID in endpoint examples", () => {
    const result = buildInstructions("my-task-123");
    assert.match(result, /my-task-123/);
  });

  it("includes port in endpoint URL", () => {
    const result = buildInstructions("test");
    assert.match(result, /localhost:7256/);
  });

  it("includes task description", () => {
    const result = buildInstructions("test");
    assert.match(result, /Test task prompt/);
  });

});


describe("generateEndpointDocs", () => {
  const docs = generateEndpointDocs(7256, "test-id", mockTools, mockResources);

  it("matches expected full output", () => {
    const expected = [
      "The following HTTP endpoints are available during task execution. Use curl to call them.",
      "",
      "**`POST http://localhost:7256/mock-action?taskId=test-id`** — Perform a mock action.",
      "```json",
      '{"title":"...","detail":"..."}',
      "```",
      "- `title` (required, string): Action title",
      "- `detail` (optional, string): Optional detail",
      '- Response: `{"ok": true}` on success.',
      "",
      "**`POST http://localhost:7256/mock-query?taskId=test-id`** — Query mock data from the device.",
      "```json",
      '{"tags":["..."]}',
      "```",
      "- `tags` (optional, string array): Filter tags",
      "- Blocks until the device responds.",
      '- Response: `{"data": ...}` on success.',
      "",
      "**`GET http://localhost:7256/mock-data?taskId=test-id`** — Get mock data from the device.",
      "- Response: JSON array of data objects.",
    ].join("\n");
    assert.equal(docs, expected);
  });

  it("generates docs for all provided tools", () => {
    for (const tool of mockTools) {
      assert.match(docs, new RegExp(`POST http://localhost:7256/${tool.name}\\?taskId=`), `Missing endpoint for ${tool.name}`);
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
    assert.match(docs, /localhost:7256/);
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
      assert.match(docs, new RegExp(`GET http://localhost:7256${resource.restPath}`), `Missing endpoint for ${resource.restPath}`);
    }
  });

  it("includes resource description as bullet points", () => {
    assert.match(docs, /- Response: JSON array of data objects\./);
  });

  it("generates no resource endpoints when resources array is empty", () => {
    const docsNoResources = generateEndpointDocs(7256, "test-id", mockTools, []);
    assert.doesNotMatch(docsNoResources, /GET http/);
  });
});
