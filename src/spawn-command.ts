import crossSpawn from "cross-spawn";
import { execFileSync, type ChildProcess } from "child_process";

/** Kill a child process and its entire tree on Windows; plain kill elsewhere. */
function treeKill(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], { windowsHide: true, stdio: "pipe" });
      return;
    } catch { /* fall through */ }
  }
  child.kill();
}

export interface SpawnStreamingOptions {
  cwd: string;
  env?: Record<string, string>;
}

/**
 * Spawn with shell interpretation for piped commands like "tail -f log | grep".
 * Returns the ChildProcess with stdout piped so the caller can read it directly
 * (contrast with spawnCommand which buffers). stdin is "pipe" (held open, not
 * written to): some long-running commands exit on stdin EOF. Agent CLIs like
 * `claude -p` conversely hang on an open stdin, which is why spawnCommand
 * defaults to "ignore".
 */
export function spawnStreamingCommand(
  command: string,
  opts: SpawnStreamingOptions,
): ChildProcess {
  return crossSpawn(command, [], {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    windowsHide: true,
  });
}

export interface SpawnCommandOptions {
  cwd: string;
  env?: Record<string, string>;
  timeout?: number;
  /** Echo stdout to process.stdout (useful for journald logging). */
  echoStdout?: boolean;
  /** Resolve with output even on non-zero exit (instead of rejecting). */
  resolveOnFailure?: boolean;
  /** If provided, write this string to the process's stdin and then close the pipe. */
  stdin?: string;
  /** Called on each chunk of output (stdout + stderr combined). */
  onData?: (chunk: string) => void;
  /** Called on each chunk from stdout only. Fires alongside `onData`. */
  onStdout?: (chunk: string) => void;
  /** Called on each chunk from stderr only. Fires alongside `onData`. */
  onStderr?: (chunk: string) => void;
}

/**
 * cross-spawn resolves .cmd shims and escapes args on Windows without shell:true
 * (which mishandles special characters). stdin defaults to "ignore" because
 * tools like `claude -p` hang on an open stdin pipe; pass opts.stdin to write
 * a string and then close the pipe.
 */
export interface SpawnCommandResult {
  output: string;
  exitCode: number | null;
}

export function spawnCommand(
  command: string,
  args: string[],
  opts: SpawnCommandOptions,
): Promise<SpawnCommandResult> {
  return new Promise<SpawnCommandResult>((resolve, reject) => {
    // cmd.exe can't handle literal newlines in arguments.
    const finalArgs = process.platform === "win32"
      ? args.map((a) => a.replace(/[\r\n]+/g, " "))
      : args;
    const truncate = (s: string, max = 100) => s.length > max ? s.slice(0, max) + "..." : s;
    const displayArgs = finalArgs.map((arg) => truncate(arg));

    console.log(`[spawn] ${command} ${displayArgs.join(" ")}`);

    const child = crossSpawn(command, finalArgs, {
      cwd: opts.cwd,
      stdio: [opts.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      windowsHide: true,
    });

    if (opts.stdin != null) {
      child.stdin!.end(opts.stdin);
    }

    const chunks: Buffer[] = [];
    child.stdout!.on("data", (d: Buffer) => {
      chunks.push(d);
      if (opts.echoStdout) process.stdout.write(d);
      const s = d.toString("utf-8");
      opts.onData?.(s);
      opts.onStdout?.(s);
    });
    child.stderr!.on("data", (d: Buffer) => {
      process.stderr.write(d);
      const s = d.toString("utf-8");
      opts.onData?.(s);
      opts.onStderr?.(s);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      timer = setTimeout(() => {
        treeKill(child);
        reject(new Error("command timed out"));
      }, opts.timeout);
    }

    child.on("close", (code: number | null) => {
      if (timer) clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf-8");
      if (code === 0 || opts.resolveOnFailure) resolve({ output, exitCode: code });
      else reject(new Error(`process exited with code ${code}`));
    });

    child.on("error", (err: Error) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
