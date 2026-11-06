import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createPendingRun, readPendingRun, claimPendingRun, appendRunMessage } from "../src/task.js";

const TASK_ID = "task-1";
let projectRoot: string;
let taskDir: string;

function historyRunIds(): string[] {
  const p = path.join(projectRoot, "history.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l).run_id);
}

describe("pending run handoff", () => {
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-pending-"));
    taskDir = path.join(projectRoot, "tasks", TASK_ID);
    fs.mkdirSync(taskDir, { recursive: true });
  });

  it("hands the created run to exactly one claimer", () => {
    const runId = createPendingRun(projectRoot, taskDir, TASK_ID, "Task");
    assert.equal(readPendingRun(taskDir), runId);
    assert.equal(claimPendingRun(taskDir), runId);
    assert.equal(claimPendingRun(taskDir), null);
    assert.equal(readPendingRun(taskDir), null);
  });

  it("returns null when nothing is pending", () => {
    assert.equal(readPendingRun(taskDir), null);
    assert.equal(claimPendingRun(taskDir), null);
  });

  it("does not treat a run that already has status as pending", () => {
    const runId = createPendingRun(projectRoot, taskDir, TASK_ID, "Task");
    appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "start failed", type: "failed" });
    assert.equal(readPendingRun(taskDir), null);
    assert.equal(claimPendingRun(taskDir), null);
  });

  it("discards a stale unclaimed run when a new one is created", async () => {
    const stale = createPendingRun(projectRoot, taskDir, TASK_ID, "Task");
    await new Promise((r) => setTimeout(r, 5));
    const fresh = createPendingRun(projectRoot, taskDir, TASK_ID, "Task");
    assert.notEqual(stale, fresh);
    assert.equal(fs.existsSync(path.join(taskDir, stale)), false);
    assert.deepEqual(historyRunIds(), [fresh]);
    assert.equal(claimPendingRun(taskDir), fresh);
  });

  it("keeps a claimed run when the next one is created", async () => {
    const first = createPendingRun(projectRoot, taskDir, TASK_ID, "Task");
    claimPendingRun(taskDir);
    appendRunMessage(taskDir, first, { role: "status", time: Date.now(), content: "", type: "started" });
    await new Promise((r) => setTimeout(r, 5));
    const second = createPendingRun(projectRoot, taskDir, TASK_ID, "Task");
    assert.deepEqual(historyRunIds(), [first, second]);
    assert.equal(fs.existsSync(path.join(taskDir, first)), true);
  });
});
