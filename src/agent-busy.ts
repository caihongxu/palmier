/**
 * Detect whether an agent CLI is currently in use, so the daemon never updates
 * it (and the PWA never offers to) while a run is mid-flight.
 *
 * An agent is "busy" if some task using it has a run in progress. A task's runs
 * are sequential, so its `status.json` (`running_state: "started"`) is the
 * authoritative current-state signal. We enumerate candidate tasks from the
 * recent window of `history.jsonl` rather than `listTasks` — history includes
 * one-off/ad-hoc runs (which aren't in the task list) and is bounded to recent
 * activity, so old irrelevant tasks are never read.
 */

import { getTaskDir, readTaskStatus, parseTaskFile, readRecentHistory } from "./task.js";
import type { HostConfig } from "./types.js";

const BUSY_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Agent keys with a run currently in progress. */
export function getBusyAgents(config: HostConfig): Set<string> {
  const busy = new Set<string>();
  const seen = new Set<string>();
  for (const { task_id } of readRecentHistory(config.projectRoot, Date.now() - BUSY_WINDOW_MS)) {
    if (seen.has(task_id)) continue;
    seen.add(task_id);
    const taskDir = getTaskDir(config.projectRoot, task_id);
    if (readTaskStatus(taskDir)?.running_state !== "started") continue;
    try {
      const agent = parseTaskFile(taskDir).frontmatter.agent;
      if (agent) busy.add(agent);
    } catch { /* task directory removed since the run */ }
  }
  return busy;
}

export function isAgentBusy(config: HostConfig, agentKey: string): boolean {
  return getBusyAgents(config).has(agentKey);
}
