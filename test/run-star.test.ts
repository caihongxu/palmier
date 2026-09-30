import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isRunStarred, setRunStarred } from "../src/task.js";

let runDir: string;

describe("run starring", () => {
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-star-"));
  });

  it("is unstarred by default", () => {
    assert.equal(isRunStarred(runDir), false);
  });

  it("toggles on and off", () => {
    setRunStarred(runDir, true);
    assert.equal(isRunStarred(runDir), true);
    setRunStarred(runDir, false);
    assert.equal(isRunStarred(runDir), false);
  });

  it("is idempotent in both directions", () => {
    setRunStarred(runDir, true);
    setRunStarred(runDir, true);
    assert.equal(isRunStarred(runDir), true);
    setRunStarred(runDir, false);
    setRunStarred(runDir, false);
    assert.equal(isRunStarred(runDir), false);
  });
});
