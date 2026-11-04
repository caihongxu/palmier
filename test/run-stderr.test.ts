import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ConversationMessage } from "../src/types.js";

const FAKE_CODEX = `
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(process.env.FAKE_STDOUT ?? "");
  process.stderr.write(process.env.FAKE_STDERR ?? "");
  process.exitCode = Number(process.env.FAKE_EXIT ?? 0);
});
`;

let root: string;
let originalEnv: NodeJS.ProcessEnv;
let runCommand: (typeof import("../src/commands/run.js"))["runCommand"];
let task: typeof import("../src/task.js");
let taskCounter = 0;

function installFakeCodex(binDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "fake-codex.cjs"), FAKE_CODEX);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "codex.cmd"), `@node "%~dp0fake-codex.cjs"\r\n@exit /b %errorlevel%\r\n`);
  } else {
    fs.writeFileSync(path.join(binDir, "codex"), `#!/bin/sh\nexec node "$(dirname "$0")/fake-codex.cjs"\n`, { mode: 0o755 });
  }
}

async function runFakeCodex(opts: { stdout?: string; stderr?: string; exitCode?: number }): Promise<ConversationMessage[]> {
  process.env.FAKE_STDOUT = opts.stdout ?? "";
  process.env.FAKE_STDERR = opts.stderr ?? "";
  process.env.FAKE_EXIT = String(opts.exitCode ?? 0);

  const taskId = `task-${++taskCounter}`;
  const taskDir = task.getTaskDir(root, taskId);
  task.writeTaskFile(taskDir, {
    frontmatter: {
      id: taskId,
      name: "Test",
      user_prompt: "Do something",
      agent: "codex",
      schedule_enabled: false,
      requires_confirmation: false,
    },
  });

  await runCommand(taskId);

  const [runId] = fs.readdirSync(taskDir).filter((f) => /^\d+$/.test(f));
  return task.readRunMessages(taskDir, runId);
}

const stderrMessages = (messages: ConversationMessage[]) => messages.filter((m) => m.stream === "stderr");
const finalStatus = (messages: ConversationMessage[]) => messages.filter((m) => m.role === "status").at(-1)?.type;

describe("runCommand with an agent that suppresses stderr", () => {
  before(async () => {
    originalEnv = { ...process.env };
    root = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-run-stderr-"));
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

  it("persists stderr when the agent exits non-zero, after its stdout", async () => {
    const messages = await runFakeCodex({
      stdout: "working on it\n",
      stderr: "progress log\nError: auth expired\nno trailing newline",
      exitCode: 1,
    });

    assert.equal(finalStatus(messages), "failed");
    const [stderr, ...rest] = stderrMessages(messages);
    assert.equal(rest.length, 0);
    assert.equal(stderr.content, "progress log\nError: auth expired\nno trailing newline");
    const stdoutIndex = messages.findIndex((m) => m.stream === "stdout" && m.content === "working on it");
    assert.ok(stdoutIndex !== -1 && stdoutIndex < messages.indexOf(stderr));
  });

  it("persists stderr when the agent exits zero but reports failure", async () => {
    const messages = await runFakeCodex({
      stdout: "could not do it\n[PALMIER_TASK_FAILURE]\n",
      stderr: "Error: tool crashed\n",
    });

    assert.equal(finalStatus(messages), "failed");
    assert.deepEqual(stderrMessages(messages).map((m) => m.content), ["Error: tool crashed"]);
  });

  it("persists stderr when a failing agent wrote nothing to stdout", async () => {
    const messages = await runFakeCodex({ stderr: "Error: not logged in\n", exitCode: 1 });

    assert.equal(finalStatus(messages), "failed");
    assert.deepEqual(stderrMessages(messages).map((m) => m.content), ["Error: not logged in"]);
  });

  it("does not persist stderr when the task succeeds", async () => {
    const messages = await runFakeCodex({
      stdout: "all done\n[PALMIER_TASK_SUCCESS]\n",
      stderr: "noisy progress log\n",
    });

    assert.equal(finalStatus(messages), "finished");
    assert.deepEqual(stderrMessages(messages), []);
  });
});
