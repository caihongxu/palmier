import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { getTaskDir, parseTaskFile } from "../task.js";
import { requestUserInput, publishInputResolved } from "../user-input.js";

/**
 * Request input from the user and print responses to stdout.
 * Usage: palmier request-input --description "Question 1" --description "Question 2"
 *
 * Requires PALMIER_TASK_ID environment variable to be set.
 * Outputs each response on its own line: "description: value"
 */
export async function requestInputCommand(opts: { description: string[] }): Promise<void> {
  const taskId = process.env.PALMIER_TASK_ID;
  if (!taskId) {
    console.error("Error: PALMIER_TASK_ID environment variable is not set.");
    process.exit(1);
  }

  const config = loadConfig();
  const nc = await connectNats(config);
  const taskDir = getTaskDir(config.projectRoot, taskId);
  const task = parseTaskFile(taskDir);

  try {
    const response = await requestUserInput(nc, config, taskId, task.frontmatter.name, taskDir, opts.description);
    await publishInputResolved(nc, config, taskId, response === "aborted" ? "aborted" : "provided");

    if (response === "aborted") {
      console.error("User aborted the input request.");
      process.exit(1);
    }

    for (let i = 0; i < opts.description.length; i++) {
      console.log(response[i]);
    }
  } catch (err) {
    console.error(`Error requesting user input: ${err}`);
    process.exit(1);
  } finally {
    if (nc) await nc.drain();
  }
}
