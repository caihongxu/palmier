import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ParsedTask } from "../src/types.js";

// getTaskRunCommandLine -> getAgentInstructions -> loadConfig() reads
// ~/.config/palmier/host.json. CI has no such file, so point HOME at a temp
// dir with a stub config before any module that might call loadConfig loads.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-test-home-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
fs.mkdirSync(path.join(tmpHome, ".config", "palmier"), { recursive: true });
fs.writeFileSync(path.join(tmpHome, ".config", "palmier", "host.json"), JSON.stringify({
  hostId: "test-host",
  projectRoot: tmpHome,
  natsUrl: "nats://localhost:4222",
  natsJwt: "test-jwt",
  natsNkeySeed: "test-seed",
  httpPort: 7256,
}));

// Import via agent.ts first so the full agent registry loads before gemini.ts
// is touched directly. shared-prompt.ts re-imports agent.ts, so a direct
// import of any single agent module would otherwise trip a TDZ error.
// Dynamic imports keep these AFTER the env setup above (static ESM imports are
// hoisted to module-eval, before any top-level statements).
await import("../src/agents/agent.js");
const { geminiAgent, renderPolicyToml } = await import("../src/agents/gemini.js");

function makeTask(perms: Array<{ name: string; description: string }> = []): ParsedTask {
  return {
    frontmatter: {
      id: "task-1",
      name: "test",
      user_prompt: "do something",
      agent: "gemini",
      schedule_enabled: false,
      requires_confirmation: false,
      permissions: perms,
    },
  };
}

describe("renderPolicyToml", () => {
  it("emits an allow rule with the listed tools and a deny fallback", () => {
    const toml = renderPolicyToml(["run_shell_command", "web_fetch", "read_file"]);
    assert.match(toml, /\[\[rule\]\][\s\S]*toolName = \["run_shell_command", "web_fetch", "read_file"\][\s\S]*decision = "allow"/);
    assert.match(toml, /\[\[rule\]\][\s\S]*toolName = "\*"[\s\S]*decision = "deny"/);
  });

  it("escapes tool names as TOML basic strings", () => {
    const toml = renderPolicyToml(["a", `b"c`]);
    assert.match(toml, /toolName = \["a", "b\\"c"\]/);
  });
});

describe("geminiAgent.getTaskRunCommandLine", () => {
  const agent = geminiAgent;

  it("yolo mode: no policy file, no --admin-policy, no --allowed-tools", () => {
    const cl = agent.getTaskRunCommandLine(makeTask(), undefined, "yolo");
    assert.equal(cl.files, undefined);
    assert.equal(cl.args.includes("--admin-policy"), false);
    assert.equal(cl.args.includes("--allowed-tools"), false);
    assert.equal(cl.args.includes("--approval-mode"), true);
    assert.equal(cl.args[cl.args.indexOf("--approval-mode") + 1], "yolo");
  });

  it("non-yolo: writes gemini-policy.toml and references it via --admin-policy", () => {
    const cl = agent.getTaskRunCommandLine(makeTask(), undefined, []);
    assert.ok(cl.files && cl.files.length === 1);
    assert.equal(cl.files![0].path, "gemini-policy.toml");
    assert.match(cl.files![0].content, /toolName = \["run_shell_command\(curl\)", "web_fetch"\]/);
    const idx = cl.args.indexOf("--admin-policy");
    assert.notEqual(idx, -1);
    assert.equal(cl.args[idx + 1], "gemini-policy.toml");
    assert.equal(cl.args.includes("--allowed-tools"), false);
  });

  it("non-yolo: merges task frontmatter permissions and transient extra permissions", () => {
    const task = makeTask([{ name: "read_file", description: "read" }]);
    const cl = agent.getTaskRunCommandLine(task, undefined, [{ name: "write_file", description: "write" }]);
    const policy = cl.files![0].content;
    assert.match(policy, /"read_file"/);
    assert.match(policy, /"write_file"/);
    assert.match(policy, /"run_shell_command\(curl\)"/);
    assert.match(policy, /"web_fetch"/);
  });

  it("followup: --resume is added and policy is still generated", () => {
    const cl = agent.getTaskRunCommandLine(makeTask(), "followup message", []);
    assert.equal(cl.args.includes("--resume"), true);
    assert.ok(cl.files && cl.files.length === 1);
    assert.equal(cl.stdin, "followup message");
  });
});
