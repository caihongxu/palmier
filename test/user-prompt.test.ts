import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ParsedTask, RpcMessage } from "../src/types.js";

let root: string;
let originalEnv: NodeJS.ProcessEnv;
let handleRpc: (request: RpcMessage) => Promise<unknown>;
let getAgentInstructions: (typeof import("../src/agents/shared-prompt.js"))["getAgentInstructions"];

const task = { frontmatter: { id: "t1", user_prompt: "Describe the weather" } } as ParsedTask;
const rpc = (method: string, params: Record<string, unknown> = {}) => handleRpc({ method, params, localhost: true });

describe("host user prompt", () => {
  before(async () => {
    originalEnv = { ...process.env };
    root = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-user-prompt-"));
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    const configDir = path.join(root, ".config", "palmier");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "host.json"), JSON.stringify({
      hostId: "test-host",
      projectRoot: root,
      natsUrl: "nats://localhost",
      natsJwt: "jwt",
      natsNkeySeed: "seed",
      httpPort: 1,
    }));

    // CONFIG_DIR is computed from the home directory when the config module loads.
    const { loadConfig } = await import("../src/config.js");
    const { createRpcHandler } = await import("../src/rpc-handler.js");
    ({ getAgentInstructions } = await import("../src/agents/shared-prompt.js"));
    handleRpc = createRpcHandler(loadConfig());
  });

  after(() => {
    process.env = originalEnv;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reports an empty prompt by default and adds nothing to the instructions", async () => {
    const info = await rpc("host.info") as { user_prompt?: string };
    assert.equal(info.user_prompt, "");
    assert.doesNotMatch(getAgentInstructions(task), /Standing Instructions/);
  });

  it("saves the prompt so a separately launched run picks it up", async () => {
    const saved = await rpc("host.setUserPrompt", { user_prompt: "  Answer in French.  " }) as { user_prompt?: string };
    assert.equal(saved.user_prompt, "Answer in French.");

    const info = await rpc("host.info") as { user_prompt?: string };
    assert.equal(info.user_prompt, "Answer in French.");

    const instructions = getAgentInstructions(task);
    assert.ok(instructions.indexOf("Answer in French.") < instructions.indexOf("Describe the weather"));
    assert.ok(instructions.includes("Answer in French."));
  });

  it("clears the prompt when given blank text", async () => {
    await rpc("host.setUserPrompt", { user_prompt: "   " });
    const info = await rpc("host.info") as { user_prompt?: string };
    assert.equal(info.user_prompt, "");
    assert.doesNotMatch(getAgentInstructions(task), /Standing Instructions/);
  });

  it("rejects a non-string prompt", async () => {
    const result = await rpc("host.setUserPrompt", { user_prompt: 42 }) as { error?: string };
    assert.equal(result.error, "user_prompt is required");
  });
});
