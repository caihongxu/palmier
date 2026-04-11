# Disclaimer

**USE AT YOUR OWN RISK.** Palmier is provided on an "AS IS" and "AS AVAILABLE" basis, without warranties of any kind, either express or implied.

## AI Agent Execution

Palmier spawns third-party AI agent CLIs (such as Claude Code, Gemini CLI, Codex CLI, GitHub Copilot, and others) that can:

- **Read, create, modify, and delete files** on your machine
- **Execute arbitrary shell commands** with your user permissions
- **Make network requests** and interact with external services

AI agents may produce unexpected, incorrect, or harmful outputs. **You are solely responsible for reviewing and approving all actions taken by AI agents on your system.** The authors of Palmier have no control over the behavior of third-party AI agents and accept no liability for their actions.

## Unattended and Scheduled Execution

Tasks can be configured to run on schedules (cron) or in response to events without active supervision. You should:

- Use the **confirmation** feature for sensitive tasks
- Restrict **permissions** granted to agents to the minimum necessary
- Regularly review **task history and results**
- Maintain **backups** of any important data in directories where agents operate

## Third-Party Services

Task prompts and execution data may be transmitted to third-party AI service providers (Anthropic, Google, OpenAI, etc.) according to their respective terms and privacy policies. Palmier does not install and has no control over how these services process your data.

When using server mode, communication between your device and the host is relayed through the Palmier server. See the [Privacy Policy](https://www.palmier.me/privacy) for details on what data is collected.

## Limitation of Liability

To the maximum extent permitted by applicable law, the authors and contributors of Palmier shall not be liable for any direct, indirect, incidental, special, consequential, or exemplary damages arising from the use of this software, including but not limited to damages for loss of data, loss of profits, business interruption, or any other commercial damages or losses.

## No Professional Advice

Palmier is a developer tool, not a substitute for professional advice. Do not rely on AI-generated outputs for critical decisions without independent verification.
