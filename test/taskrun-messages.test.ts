import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createRunDir,
  appendRunMessage,
  readRunMessages,
  beginStreamingMessage,
  spliceUserMessage,
} from "../src/task.js";

let taskDir: string;
let runId: string;

function setup() {
  taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-test-"));
  runId = createRunDir(taskDir, "Test Task", 1000, "claude");
}

describe("appendRunMessage + readRunMessages", () => {
  beforeEach(setup);

  it("writes and reads a user message", () => {
    appendRunMessage(taskDir, runId, { role: "user", time: 1001, content: "Hello" });
    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[0].content, "Hello");
    assert.equal(msgs[0].time, 1001);
  });

  it("writes and reads an assistant message", () => {
    appendRunMessage(taskDir, runId, { role: "assistant", time: 1002, content: "Hi there" });
    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, "assistant");
    assert.equal(msgs[0].content, "Hi there");
  });

  it("writes and reads a status message", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1003, content: "", type: "started" });
    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, "status");
    assert.equal(msgs[0].type, "started");
  });

  it("preserves message type", () => {
    appendRunMessage(taskDir, runId, { role: "user", time: 1004, content: "Confirmed", type: "confirmation" });
    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs[0].type, "confirmation");
  });

  it("preserves attachments", () => {
    appendRunMessage(taskDir, runId, { role: "assistant", time: 1005, content: "Done", attachments: ["report.md", "chart.png"] });
    const msgs = readRunMessages(taskDir, runId);
    assert.deepEqual(msgs[0].attachments, ["report.md", "chart.png"]);
  });

  it("reads multiple messages in order", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1001, content: "Do something" });
    appendRunMessage(taskDir, runId, { role: "assistant", time: 1002, content: "Done" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1003, content: "", type: "finished" });
    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 4);
    assert.equal(msgs[0].type, "started");
    assert.equal(msgs[1].role, "user");
    assert.equal(msgs[2].role, "assistant");
    assert.equal(msgs[3].type, "finished");
  });
});

describe("confirmation flow", () => {
  beforeEach(setup);

  it("records confirmation with assistant prompt, user response, and status", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "assistant", time: 1001, content: '**Task Confirmation**\n\nRun task "My Task"?', type: "confirmation" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1002, content: "Confirmed", type: "confirmation" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1003, content: "", type: "confirmation" });

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 4);
    assert.equal(msgs[1].role, "assistant");
    assert.ok(msgs[1].content.includes("Task Confirmation"));
    assert.equal(msgs[2].role, "user");
    assert.equal(msgs[2].content, "Confirmed");
    assert.equal(msgs[3].role, "status");
    assert.equal(msgs[3].type, "confirmation");
  });

  it("records aborted confirmation", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "assistant", time: 1001, content: '**Task Confirmation**\n\nRun task "My Task"?', type: "confirmation" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1002, content: "Aborted", type: "confirmation" });
    appendRunMessage(taskDir, runId, { role: "status", time: 1003, content: "", type: "aborted" });

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 4);
    assert.equal(msgs[2].content, "Aborted");
    assert.equal(msgs[3].type, "aborted");
  });
});

describe("beginStreamingMessage", () => {
  beforeEach(setup);

  it("streams chunks and finalizes", () => {
    const writer = beginStreamingMessage(taskDir, runId, 2000);
    writer.write("Hello ");
    writer.write("world");
    writer.end();

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, "assistant");
    assert.equal(msgs[0].content, "Hello world");
  });

  it("attaches report files to the last assistant message", () => {
    const writer = beginStreamingMessage(taskDir, runId, 2000);
    writer.write("Generated report.");
    writer.end(["report.md", "chart.png"]);

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 1);
    assert.deepEqual(msgs[0].attachments, ["report.md", "chart.png"]);
  });
});

describe("spliceUserMessage", () => {
  beforeEach(setup);

  it("splits assistant stream for user input", () => {
    const writer = beginStreamingMessage(taskDir, runId, 2000);
    writer.write("Working on it...");

    spliceUserMessage(taskDir, runId, { role: "user", time: 2001, content: "my-api-key", type: "input" });

    writer.write("Continuing with key.");
    writer.end();

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].role, "assistant");
    assert.equal(msgs[0].content, "Working on it...");
    assert.equal(msgs[1].role, "user");
    assert.equal(msgs[1].content, "my-api-key");
    assert.equal(msgs[1].type, "input");
    assert.equal(msgs[2].role, "assistant");
    assert.equal(msgs[2].content, "Continuing with key.");
  });

  it("appends assistant text before splicing", () => {
    const writer = beginStreamingMessage(taskDir, runId, 2000);
    writer.write("Processing");

    spliceUserMessage(
      taskDir, runId,
      { role: "user", time: 2001, content: "answer1", type: "input" },
      "\n\n**What is your key?**",
    );

    writer.write("Done.");
    writer.end();

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 3);
    assert.ok(msgs[0].content.includes("What is your key?"));
    assert.equal(msgs[1].content, "answer1");
    assert.equal(msgs[2].content, "Done.");
  });

  it("attaches reports to last assistant message after splice", () => {
    const writer = beginStreamingMessage(taskDir, runId, 2000);
    writer.write("Part 1");

    spliceUserMessage(taskDir, runId, { role: "user", time: 2001, content: "input", type: "input" });

    writer.write("Part 2");
    writer.end(["report.md"]);

    const msgs = readRunMessages(taskDir, runId);
    // Attachments should be on the last assistant message (after splice), not the first
    assert.equal(msgs[0].attachments, undefined);
    assert.deepEqual(msgs[2].attachments, ["report.md"]);
  });
});

describe("permission flow", () => {
  beforeEach(setup);

  it("records permission grant as user message", () => {
    appendRunMessage(taskDir, runId, { role: "status", time: 1000, content: "", type: "started" });
    appendRunMessage(taskDir, runId, { role: "user", time: 1001, content: "Do something" });
    // Simulate agent output with permission request (via streaming)
    const writer = beginStreamingMessage(taskDir, runId, 1002);
    writer.write("I need permission.\n\n**Permissions requested:**\n- **Read** Read files\n");
    writer.end();
    // Permission granted
    appendRunMessage(taskDir, runId, { role: "user", time: 1003, content: "Granted", type: "permission" });

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs.length, 4);
    assert.equal(msgs[3].role, "user");
    assert.equal(msgs[3].content, "Granted");
    assert.equal(msgs[3].type, "permission");
  });

  it("records permission denial", () => {
    appendRunMessage(taskDir, runId, { role: "user", time: 1001, content: "Do something" });
    const writer = beginStreamingMessage(taskDir, runId, 1002);
    writer.write("Need permission.");
    writer.end();
    appendRunMessage(taskDir, runId, { role: "user", time: 1003, content: "Denied", type: "permission" });

    const msgs = readRunMessages(taskDir, runId);
    assert.equal(msgs[2].content, "Denied");
    assert.equal(msgs[2].type, "permission");
  });
});
