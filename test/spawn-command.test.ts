import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveCommand, spawnCommand } from "../src/spawn-command.js";

describe("spawnCommand", () => {
  it("resolves when the child exits even if a grandchild still holds its stdio", async () => {
    const parentScript = [
      "const { spawn } = require('child_process');",
      "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'],",
      "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
      "grandchild.unref();",
      "console.log('pid=' + grandchild.pid);",
    ].join("\n");
    const start = Date.now();
    const { output, exitCode } = await spawnCommand(process.execPath, ["-e", parentScript], { cwd: os.tmpdir() });
    const elapsed = Date.now() - start;
    const grandchildPid = Number(output.match(/pid=(\d+)/)?.[1]);
    try { process.kill(grandchildPid); } catch { /* already gone */ }
    assert.equal(exitCode, 0);
    assert.ok(grandchildPid > 0);
    assert.ok(elapsed < 10000, `took ${elapsed}ms`);
  });
});

const NPM_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":start",
  "SETLOCAL",
  "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@scope\\tool\\dist\\main.mjs\" %*",
  "",
].join("\r\n");

describe("resolveCommand", { skip: process.platform !== "win32" }, () => {
  let root: string;
  let savedPath: string | undefined;
  let savedPathExt: string | undefined;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-spawn-"));
    const shimDir = path.join(root, "shims");
    const exeDir = path.join(root, "exes");
    fs.mkdirSync(shimDir);
    fs.mkdirSync(exeDir);
    fs.writeFileSync(path.join(shimDir, "tool.cmd"), NPM_SHIM);
    fs.writeFileSync(path.join(shimDir, "custom.cmd"), "@echo off\r\nsomething-else.exe %*\r\n");
    fs.writeFileSync(path.join(shimDir, "shadowed.cmd"), NPM_SHIM);
    fs.writeFileSync(path.join(exeDir, "shadowed.exe"), "");
    savedPath = process.env.PATH;
    savedPathExt = process.env.PATHEXT;
    process.env.PATH = [exeDir, shimDir].join(path.delimiter);
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
  });

  after(() => {
    process.env.PATH = savedPath;
    process.env.PATHEXT = savedPathExt;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs an npm node shim's script directly, preserving newlines", () => {
    const resolved = resolveCommand("tool", ["-p", "line one\nline two"]);
    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [
      path.join(root, "shims", "node_modules", "@scope", "tool", "dist", "main.mjs"),
      "-p",
      "line one\nline two",
    ]);
  });

  it("falls back to the original command for non-npm shims, flattening newlines", () => {
    const resolved = resolveCommand("custom", ["a\r\nb"]);
    assert.deepEqual(resolved, { command: "custom", args: ["a b"] });
  });

  it("leaves commands that resolve to an executable earlier on PATH alone", () => {
    assert.equal(resolveCommand("shadowed", []).command, "shadowed");
  });

  it("leaves unknown commands alone", () => {
    assert.equal(resolveCommand("missing", []).command, "missing");
  });
});
