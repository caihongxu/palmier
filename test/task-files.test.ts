import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  FILE_CHUNK_SIZE,
  extractFileLinks,
  hrefToFilePath,
  readTaskFileChunk,
  resolveTaskFile,
} from "../src/task-files.js";
import { listLinkedTaskFiles } from "../src/commands/run.js";

let root: string;
let taskDir: string;
const runId = "1000";

function setup() {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "palmier-files-")));
  taskDir = path.join(root, "tasks", "task-a");
  fs.mkdirSync(path.join(taskDir, runId, "sub"), { recursive: true });
  fs.writeFileSync(path.join(taskDir, runId, "report.md"), "# Report");
  fs.writeFileSync(path.join(taskDir, runId, "sub", "chart.png"), "png");
  fs.writeFileSync(path.join(taskDir, "shared.txt"), "shared");
  fs.mkdirSync(path.join(root, "tasks", "task-b"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", "task-b", "secret.md"), "secret");
}

describe("hrefToFilePath", () => {
  it("passes relative paths through, decoding percent-escapes", () => {
    assert.equal(hrefToFilePath("sub/my%20report.md"), "sub/my report.md");
  });

  it("strips query strings and fragments", () => {
    assert.equal(hrefToFilePath("report.md#summary"), "report.md");
  });

  it("treats Windows drive paths as files, not URL schemes", () => {
    assert.equal(hrefToFilePath("C:\\Users\\me\\report.md"), "C:\\Users\\me\\report.md");
  });

  it("converts file URLs to paths", () => {
    const filePath = path.join(os.tmpdir(), "report.md");
    assert.equal(hrefToFilePath(pathToFileURL(filePath).href), filePath);
  });

  it("ignores external URLs and anchors", () => {
    for (const href of ["https://example.com/a.md", "mailto:a@b.com", "#top", "//cdn.example.com/x.png", ""]) {
      assert.equal(hrefToFilePath(href), null, href);
    }
  });
});

describe("extractFileLinks", () => {
  it("collects local link and image targets, deduplicated", () => {
    const markdown = [
      "See [the report](report.md) and ![chart](sub/chart.png \"Chart\").",
      "Also [again](report.md), [spaced](<my report.md>) and [site](https://example.com).",
    ].join("\n");
    assert.deepEqual(extractFileLinks(markdown), ["report.md", "sub/chart.png", "my report.md"]);
  });
});

describe("resolveTaskFile", () => {
  beforeEach(setup);

  it("resolves paths relative to the run directory", () => {
    assert.equal(resolveTaskFile(taskDir, runId, "report.md"), path.join(taskDir, runId, "report.md"));
  });

  it("resolves paths into subdirectories", () => {
    assert.equal(resolveTaskFile(taskDir, runId, "sub/chart.png"), path.join(taskDir, runId, "sub", "chart.png"));
  });

  it("accepts absolute paths and siblings inside the task directory", () => {
    const absolute = path.join(taskDir, runId, "report.md");
    assert.equal(resolveTaskFile(taskDir, runId, absolute), absolute);
    assert.equal(resolveTaskFile(taskDir, runId, "../shared.txt"), path.join(taskDir, "shared.txt"));
  });

  it("rejects paths outside the task directory", () => {
    assert.throws(() => resolveTaskFile(taskDir, runId, "../../task-b/secret.md"), /outside the task directory/);
    assert.throws(() => resolveTaskFile(taskDir, runId, path.join(root, "tasks", "task-b", "secret.md")), /outside/);
  });

  it("rejects symlinks that escape the task directory", (t) => {
    const link = path.join(taskDir, runId, "escape.md");
    try {
      fs.symlinkSync(path.join(root, "tasks", "task-b", "secret.md"), link);
    } catch {
      t.skip("symlinks not permitted");
      return;
    }
    assert.throws(() => resolveTaskFile(taskDir, runId, "escape.md"), /outside/);
  });

  it("reports missing files", () => {
    assert.throws(() => resolveTaskFile(taskDir, runId, "missing.md"), /not found/);
  });
});

describe("readTaskFileChunk", () => {
  beforeEach(setup);

  it("returns small files in one chunk with a mime type", () => {
    const chunk = readTaskFileChunk(path.join(taskDir, runId, "report.md"));
    assert.equal(chunk.mime, "text/markdown");
    assert.equal(chunk.size, 8);
    assert.equal(Buffer.from(chunk.data, "base64").toString(), "# Report");
    assert.equal(chunk.eof, true);
  });

  it("splits large files into chunks", () => {
    const filePath = path.join(taskDir, runId, "big.bin");
    const content = Buffer.alloc(FILE_CHUNK_SIZE + 10, 7);
    fs.writeFileSync(filePath, content);

    const first = readTaskFileChunk(filePath);
    assert.equal(first.mime, "application/octet-stream");
    assert.equal(Buffer.from(first.data, "base64").length, FILE_CHUNK_SIZE);
    assert.equal(first.eof, false);

    const second = readTaskFileChunk(filePath, FILE_CHUNK_SIZE);
    assert.equal(Buffer.from(second.data, "base64").length, 10);
    assert.equal(second.eof, true);
  });

  it("rejects invalid offsets and directories", () => {
    assert.throws(() => readTaskFileChunk(path.join(taskDir, runId, "report.md"), 100), /Invalid offset/);
    assert.throws(() => readTaskFileChunk(path.join(taskDir, runId, "sub")), /Not a file/);
  });
});

describe("listLinkedTaskFiles", () => {
  beforeEach(setup);

  it("keeps only links to existing files inside the task directory", () => {
    const output = "Done: [report](report.md), [example](example.md), [other](../../task-b/secret.md), [web](https://x.com)";
    assert.deepEqual(listLinkedTaskFiles(taskDir, runId, output), ["report.md"]);
  });
});
