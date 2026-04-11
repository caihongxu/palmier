import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createRunDir,
  appendRunMessage,
  beginStreamingMessage,
} from "../src/task.js";
import { parseResultFrontmatter } from "../src/rpc-handler.js";

let taskDir: string;
let runId: string;

function setup() {
  taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-test-"));
  runId = createRunDir(taskDir, "Test Task", 1000, "claude");
}

function readRaw(): string {
  return fs.readFileSync(path.join(taskDir, runId, "TASKRUN.md"), "utf-8");
}

describe("parseResultFrontmatter — monitoring state", () => {
  beforeEach(setup);

  it("returns 'monitoring' when monitoring is the last message", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1001, content: "", type: "monitoring" });

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "monitoring");
  });

  it("returns 'started' when an assistant message follows monitoring", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1001, content: "", type: "monitoring" });
    const writer = beginStreamingMessage(taskDir, runId, 1002);
    writer.write("Working on it...");
    writer.end();

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "started");
  });

  it("returns 'monitoring' after agent finishes and monitoring resumes", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1001, content: "", type: "monitoring" });
    // Agent processes a line
    const writer = beginStreamingMessage(taskDir, runId, 1002);
    writer.write("Done processing line.");
    writer.end();
    // Back to monitoring
    appendRunMessage(taskDir, runId, { role: "status", time: 1003, content: "", type: "monitoring" });

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "monitoring");
  });

  it("returns 'started' when a user message follows monitoring", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1001, content: "", type: "monitoring" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1002, content: "some input" });

    const result = parseResultFrontmatter(readRaw());
    assert.equal(result.running_state, "started");
  });
});

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
