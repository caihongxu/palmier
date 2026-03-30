import crossSpawn from "cross-spawn";
import type { ChildProcess } from "child_process";

export interface SpawnStreamingOptions {
  cwd: string;
  env?: Record<string, string>;
}

/**
 * Spawn a command with shell interpretation, returning the ChildProcess
 * with stdout piped for line-by-line reading.
 *
 * Unlike spawnCommand(), this does NOT collect output into a buffer —
 * the caller reads from child.stdout directly (e.g. via readline).
 *
 * shell: true is required so users can write piped commands like
 * "tail -f log | grep ERROR".
 *
 * stdin is "pipe" (kept open, never written to) rather than "ignore"
 * (/dev/null). Some long-running commands exit when stdin is closed/EOF.
 * This differs from spawnCommand() which uses "ignore" because agent
 * CLIs like `claude -p` hang on an open stdin pipe.
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
}

/**
 * Spawn a command with additional arguments.
 *
 * Uses cross-spawn to correctly resolve .cmd shims and escape arguments
 * on Windows without shell: true (which mishandles special characters).
 *
 * On other platforms the command is executed directly (no shell), so no
 * escaping is needed.
 *
 * stdin is set to "ignore" by default (equivalent to < /dev/null) because
 * tools like `claude -p` hang indefinitely on an open stdin pipe.
 * When opts.stdin is provided, stdin is set to "pipe" and the string is
 * written to the process before closing the pipe.
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
    // Collapse newlines to spaces — cmd.exe can't handle literal newlines
    // in arguments, and CLI prompts don't need them.
    const finalArgs = process.platform === "win32"
      ? args.map((a) => a.replace(/[\r\n]+/g, " "))
      : args;

    // console.log(`[spawn] ${command} ${finalArgs.join(" ")}`);

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
    });
    child.stderr!.on("data", (d: Buffer) => process.stderr.write(d));

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeout) {
      timer = setTimeout(() => {
        child.kill();
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
