import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTaskContent } from "../src/task.js";

describe("parseTaskContent", () => {
  it("parses valid frontmatter and body", () => {
    const content = `---
id: abc123
name: Test Task
user_prompt: Do something
agent: claude
triggers: []
triggers_enabled: true
requires_confirmation: false
---
This is the task body.`;

    const result = parseTaskContent(content);
    assert.equal(result.frontmatter.id, "abc123");
    assert.equal(result.frontmatter.name, "Test Task");
    assert.equal(result.frontmatter.agent, "claude");
    assert.equal(result.body, "This is the task body.");
  });

  it("defaults agent to claude when not specified", () => {
    const content = `---
id: abc123
user_prompt: Do something
triggers: []
triggers_enabled: true
requires_confirmation: false
---`;

    const result = parseTaskContent(content);
    assert.equal(result.frontmatter.agent, "claude");
  });

  it("defaults triggers_enabled to true", () => {
    const content = `---
id: abc123
user_prompt: Do something
triggers: []
requires_confirmation: false
---`;

    const result = parseTaskContent(content);
    assert.equal(result.frontmatter.triggers_enabled, true);
  });

  it("derives name from user_prompt when not specified", () => {
    const content = `---
id: abc123
user_prompt: A very long prompt that should be truncated to sixty characters maximum length here
triggers: []
triggers_enabled: true
requires_confirmation: false
---`;

    const result = parseTaskContent(content);
    assert.equal(result.frontmatter.name.length, 60);
  });

  it("throws on missing frontmatter delimiters", () => {
    assert.throws(() => parseTaskContent("no frontmatter here"), /missing valid YAML/);
  });

  it("throws on missing id", () => {
    assert.throws(() => parseTaskContent("---\nname: test\n---\n"), /must include at least: id/);
  });

  it("handles empty body", () => {
    const content = `---
id: abc123
user_prompt: test
triggers: []
triggers_enabled: true
requires_confirmation: false
---`;

    const result = parseTaskContent(content);
    assert.equal(result.body, "");
  });
});
