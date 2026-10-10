import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createRunDir,
  appendRunMessage,
  beginStreamingMessage,
  formatAgentModelComment,
} from "../src/task.js";
import { parseResultFrontmatter } from "../src/rpc-handler.js";
import type { ConversationMessage } from "../src/types.js";

let taskDir: string;
let runId: string;

function setup() {
  taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-test-"));
  runId = createRunDir(taskDir, "Test Task", 1000, "claude");
}

function readRaw(): string {
  return fs.readFileSync(path.join(taskDir, runId, "TASKRUN.md"), "utf-8");
}

describe("parseResultFrontmatter — standard states", () => {
  beforeEach(setup);

  it("returns 'started' for a running task", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1001, content: "Do something" });

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "started");
  });

  it("returns 'finished' for a completed task", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1001, content: "Do something" });
    const writer = beginStreamingMessage(taskDir, runId, 1002);
    writer.write("Done.");
    writer.end();
    appendRunMessage(taskDir, runId, { role: "status", time: 1003, content: "", type: "finished" });

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "finished");
  });

  it("returns 'failed' for a failed task", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1001, content: "", type: "failed" });

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "failed");
  });

  it("returns 'followup' when started again after terminal state", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1001, content: "", type: "finished" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1002, content: "", type: "started" });

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "followup");
  });
});

describe("parseResultFrontmatter — agent model", () => {
  beforeEach(setup);

  it("extracts the model comment and strips it from content", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    const writer = beginStreamingMessage(taskDir, runId, 1001);
    writer.write("Working...\n");
    writer.write(formatAgentModelComment("claude-opus-5-5"));
    writer.write("Done.\n");
    writer.end();

    const messages = parseResultFrontmatter(readRaw()).messages as ConversationMessage[];
    assert.equal(messages[1].model, "claude-opus-5-5");
    assert.equal(messages[1].content, "Working...\nDone.");
  });

  it("shares the model across blocks of one invocation but not across follow-ups", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    const stderr = beginStreamingMessage(taskDir, runId, 1001, "stderr");
    stderr.write("log line\n");
    stderr.end();
    appendRunMessage(taskDir, runId, { role: "assistant", time: 1002, content: formatAgentModelComment("gpt-6") + "Answer", stream: "stdout" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1003, content: "", type: "finished" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1004, content: "Follow up" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1005, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "assistant", time: 1006, content: "No marker this time" });

    const messages = parseResultFrontmatter(readRaw()).messages as ConversationMessage[];
    const assistant = messages.filter((m) => m.role === "assistant");
    assert.deepEqual(assistant.map((m) => m.model), ["gpt-6", "gpt-6", undefined]);
  });
});
