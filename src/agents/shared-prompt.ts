/**
 * Instructions prepended or injected as system prompt for every task invocation.
 * Instructs the agent to output structured markers so palmier can determine
 * the task outcome, report files, and permission/input requests.
 */
export const AGENT_INSTRUCTIONS = `If you generate report or output files, print each file name on its own line prefixed with [PALMIER_REPORT]: e.g.
[PALMIER_REPORT] report.md
[PALMIER_REPORT] summary.md

When you are done, output exactly one of these markers as the very last line:
- Success: [PALMIER_TASK_SUCCESS]
- Failure: [PALMIER_TASK_FAILURE]
Do not wrap them in code blocks or add text on the same line.

If the task fails because a tool was denied or you lack the required permissions, print each required permission on its own line prefixed with [PALMIER_PERMISSION]: e.g.
[PALMIER_PERMISSION] Read | Read file contents from the repository
[PALMIER_PERMISSION] Bash(npm test) | Run the test suite via npm
[PALMIER_PERMISSION] Write | Write generated output files

If the task requires information from the user that you do not have (such as credentials, connection strings, API keys, or configuration values), print each required input on its own line prefixed with [PALMIER_INPUT]: e.g.
[PALMIER_INPUT] What is the database connection string?
[PALMIER_INPUT] What is the API key for the external service?`;

export const TASK_SUCCESS_MARKER = "[PALMIER_TASK_SUCCESS]";
export const TASK_FAILURE_MARKER = "[PALMIER_TASK_FAILURE]";
export const TASK_REPORT_PREFIX = "[PALMIER_REPORT]";
export const TASK_PERMISSION_PREFIX = "[PALMIER_PERMISSION]";
export const TASK_INPUT_PREFIX = "[PALMIER_INPUT]";
