import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { setTimeout as sleep } from "timers/promises";

const FAKE_CODEX = `
let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  if (input.includes("blue")) {
    const reminded = input.includes("[PALMIER_TASK_NEED_INPUT]");
    process.stdout.write("resumed, reminded=" + reminded + "\\n[PALMIER_TASK_SUCCESS]\\n");
  } else {
    process.stdout.write("Which colour?\\n[PALMIER_TASK_NEED_INPUT]\\n");
  }
});
`;

let root: string;
let originalEnv: NodeJS.ProcessEnv;
let runCommand: (typeof import("../src/commands/run.js"))["runCommand"];
let task: typeof import("../src/task.js");

function installFakeCodex(binDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "fake-codex.cjs"), FAKE_CODEX);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "codex.cmd"), `@node "%~dp0fake-codex.cjs"\r\n@exit /b %errorlevel%\r\n`);
  } else {
    fs.writeFileSync(path.join(binDir, "codex"), `#!/bin/sh\nexec node "$(dirname "$0")/fake-codex.cjs"\n`, { mode: 0o755 });
  }
}

async function waitForNeedsInput(taskDir: string) {
  for (let i = 0; i < 200; i++) {
    const status = task.readTaskStatus(taskDir);
    if (status?.running_state === "needs_input") return status;
    await sleep(50);
  }
  throw new Error("run never reached needs_input");
}

describe("runCommand when the agent asks for input", () => {
  before(async () => {
    originalEnv = { ...process.env };
    root = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-need-input-"));
    const binDir = path.join(root, "bin");
    installFakeCodex(binDir);

    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

    const configDir = path.join(root, ".config", "palmier");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "host.json"), JSON.stringify({
      hostId: "test-host",
      projectRoot: root,
      natsUrl: "nats://localhost",
      natsJwt: "jwt",
      natsNkeySeed: "seed",
      // Fetch refuses port 1 outright, so host events never reach a real local daemon.
      httpPort: 1,
    }));

    // CONFIG_DIR is computed from the home directory when the config module loads.
    ({ runCommand } = await import("../src/commands/run.js"));
    task = await import("../src/task.js");
  });

  after(() => {
    process.env = originalEnv;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("waits with the run process alive, then resumes the agent with the reply", async () => {
    const taskId = "ask-colour";
    const taskDir = task.getTaskDir(root, taskId);
    task.writeTaskFile(taskDir, {
      frontmatter: {
        id: taskId,
        name: "Test",
        user_prompt: "Pick something",
        agent: "codex",
        schedule_enabled: false,
        requires_confirmation: false,
      },
    });

    const run = runCommand(taskId);
    const status = await waitForNeedsInput(taskDir);
    assert.equal(status.pid, process.pid);
    const runId = status.run_id!;
    const runDir = task.getRunDir(taskDir, runId);

    assert.equal(task.writeUserReply(runDir, "blue"), true);
    await run;

    assert.equal(task.readTaskStatus(taskDir)?.running_state, "finished");
    assert.equal(fs.existsSync(path.join(runDir, ".user-reply")), false);

    const messages = task.readRunMessages(taskDir, runId);
    const statuses = messages.filter((m) => m.role === "status").map((m) => m.type);
    assert.deepEqual(statuses, ["started", "needs_input", "started", "finished"]);

    const reply = messages.find((m) => m.type === "input");
    assert.equal(reply?.role, "user");
    assert.equal(reply?.content, "blue");

    const assistant = messages.filter((m) => m.role === "assistant").map((m) => m.content);
    assert.deepEqual(assistant, ["Which colour?", "resumed, reminded=true"]);
  });

  it("refuses a second reply until the first is picked up", () => {
    const runDir = fs.mkdtempSync(path.join(root, "run-"));

    assert.equal(task.writeUserReply(runDir, "first"), true);
    assert.equal(task.writeUserReply(runDir, "second"), false);
    assert.equal(task.takeUserReply(runDir), "first");
    assert.equal(task.takeUserReply(runDir), undefined);
    assert.equal(task.writeUserReply(runDir, "third"), true);
  });
});
