import * as fs from "fs";
import * as path from "path";
import { readTaskStatus, writeTaskStatus } from "./task.js";
import { publishHostEvent } from "./events.js";
import type { HostConfig } from "./types.js";
import type { NatsConnection } from "nats";

/**
 * Watch status.json until user_input is populated by an RPC call, then resolve.
 */
export function waitForUserInput(taskDir: string): Promise<string[]> {
  const statusPath = path.join(taskDir, "status.json");
  return new Promise<string[]>((resolve) => {
    const watcher = fs.watch(statusPath, () => {
      const status = readTaskStatus(taskDir);
      if (!status || !status.user_input?.length) return;
      watcher.close();
      resolve(status.user_input);
    });
  });
}

/**
 * Send an input-request event and wait for the user's response.
 */
export async function requestUserInput(
  nc: NatsConnection | undefined,
  config: HostConfig,
  taskId: string,
  taskName: string,
  taskDir: string,
  inputDescriptions: string[],
): Promise<string[] | "aborted"> {
  const currentStatus = readTaskStatus(taskDir)!;
  writeTaskStatus(taskDir, { ...currentStatus, pending_input: inputDescriptions });

  await publishHostEvent(nc, config.hostId, taskId, {
    event_type: "input-request",
    host_id: config.hostId,
    input_descriptions: inputDescriptions,
    name: taskName,
  });

  const userInput = await waitForUserInput(taskDir);
  if (userInput.length === 1 && userInput[0] === "aborted") {
    writeTaskStatus(taskDir, { running_state: "aborted", time_stamp: Date.now() });
    return "aborted";
  }
  writeTaskStatus(taskDir, { running_state: "started", time_stamp: Date.now() });
  return userInput;
}

/**
 * Notify clients that an input request has been resolved.
 */
export async function publishInputResolved(
  nc: NatsConnection | undefined,
  config: HostConfig,
  taskId: string,
  status: "provided" | "aborted",
): Promise<void> {
  await publishHostEvent(nc, config.hostId, taskId, {
    event_type: "input-resolved",
    host_id: config.hostId,
    status,
  });
}
