# Palmier

[![CI](https://github.com/caihongxu/palmier/actions/workflows/ci.yml/badge.svg)](https://github.com/caihongxu/palmier/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/palmier)](https://www.npmjs.com/package/palmier)
[![license](https://img.shields.io/npm/l/palmier)](https://github.com/caihongxu/palmier/blob/master/LICENSE)

**Website:** [palmier.me](https://www.palmier.me) | **App:** [app.palmier.me](https://app.palmier.me)

A Node.js CLI that runs on your machine as a persistent daemon. It lets you create, schedule, and run AI agent tasks from your phone or browser, communicating via a cloud relay (NATS) and/or direct HTTP.

> **Important:** By using Palmier, you agree to the [Terms of Service](https://www.palmier.me/terms) and [Privacy Policy](https://www.palmier.me/privacy). See the [Disclaimer](#disclaimer) section below.

## Connection Modes

The host supports two independent connection modes, enabled during `palmier init`. Both can be active at the same time.

| Mode | Transport | PWA URL | Features |
|------|-----------|---------|----------|
| **Server** | Cloud relay (NATS) | `https://app.palmier.me` | Push notifications, remote access |
| **LAN** | HTTP (direct, on-demand) | `http://<host-ip>:7400` | Low-latency, no external server needed |

**Server mode** relays communication through the Palmier cloud server (via [NATS](https://nats.io), a lightweight messaging system). All features including push notifications are available. The PWA is served over HTTPS.

**LAN mode** is started on-demand via `palmier lan`. It runs a local HTTP server that reverse-proxies PWA assets from `app.palmier.me` and serves API endpoints locally. The browser accesses everything at `http://<host-ip>:<port>` (same-origin). Push notifications are not available in LAN mode.

## Prerequisites

- **Node.js 24+**
- An agent CLI tool for task execution (e.g., Claude Code, Gemini CLI, OpenAI Codex)
- **Linux with systemd** or **Windows 10/11**

## Installation

```bash
npm install -g palmier
```

All `palmier` commands should be run from a dedicated Palmier root directory (e.g., `~/palmier`). This is where tasks, configuration, and execution data are stored.

## CLI Commands

| Command | Description |
|---|---|
| `palmier init` | Interactive setup wizard |
| `palmier pair` | Generate an OTP code to pair a new device (server mode) |
| `palmier lan` | Start an on-demand LAN server with built-in pairing |
| `palmier sessions list` | List active session tokens |
| `palmier sessions revoke <token>` | Revoke a specific session token |
| `palmier sessions revoke-all` | Revoke all session tokens |
| `palmier info` | Show host connection info (address, mode) |
| `palmier serve` | Run the persistent RPC handler (default command) |
| `palmier restart` | Restart the palmier serve daemon |
| `palmier run <task-id>` | Execute a specific task |
| `palmier mcpserver` | Start an MCP server exposing Palmier tools (stdio transport) |
| `palmier agents` | Re-detect installed agent CLIs and update config |

## Setup

### Quick Start

1. Install the host: `npm install -g palmier`
2. Run `palmier init` in your Palmier root directory (e.g., `~/palmier`).
3. The wizard detects installed agents, registers with the Palmier server, installs a background daemon, and generates a pairing code.
4. Enter the pairing code in the Palmier PWA to connect your device.

### Pairing additional devices

**Server mode:** Run `palmier pair` on the host to generate a new OTP code. Enter it in the PWA at `https://app.palmier.me`.

**LAN mode:** Run `palmier lan` — it displays both the URL and a pairing code. Open the URL on your device and enter the code.

### Managing sessions

```bash
# List all paired devices
palmier sessions list

# Revoke a specific device's access
palmier sessions revoke <token>

# Revoke all sessions (unpair all devices)
palmier sessions revoke-all
```

The `init` command:
- Detects installed agent CLIs (Claude Code, Gemini CLI, Codex CLI) and caches the result
- Saves host configuration to `~/.config/palmier/host.json`
- Installs a background daemon (systemd user service on Linux, Registry Run key on Windows)
- Auto-enters pair mode to connect your first device

To re-detect agents after installing or removing a CLI, run `palmier agents`.

### Verifying the Service

After `palmier init`, verify the host is running:

**Linux:**

```bash
# Check service status
systemctl --user status palmier.service

# View recent logs
journalctl --user -u palmier.service -n 50 --no-pager

# Follow logs in real time
journalctl --user -u palmier.service -f
```

**Windows (PowerShell):**

```powershell
# Check if the daemon is running
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*palmier*serve*' }
```

**Restarting the daemon (both platforms):**

```bash
palmier restart
```

## How It Works

- The host runs as a **background daemon** (systemd user service on Linux, Registry Run key on Windows), staying alive via `palmier serve`.
- **Paired devices** communicate with the host via NATS (server mode) and/or direct HTTP (LAN mode). Each paired device gets a session token that authenticates all requests.
- **Tasks** are stored locally as Markdown files in a `tasks/` directory. Each task has a name, prompt, execution plan, and optional schedules (cron schedules or one-time dates).
- **Plan generation** is automatic — when you create or update a task, the host invokes your chosen agent CLI to generate an execution plan and name.
- **Schedules** are backed by systemd timers (Linux) or Task Scheduler (Windows). You can enable/disable them without deleting the task, and any task can still be run manually at any time.
- **Task execution** uses the system scheduler on both platforms — `systemctl --user start` on Linux, `schtasks /run` on Windows. The daemon polls every 30 seconds to detect crashed tasks (processes that exited without updating status) and marks them as failed, broadcasting the failure to connected clients.
- **Command-triggered tasks** — optionally specify a shell command (e.g., `tail -f /var/log/app.log`). Palmier runs the command continuously and invokes the agent for each line of stdout, passing it alongside your prompt. Useful for log monitoring, event-driven automation, and reactive workflows.
- **Task confirmation** — tasks can optionally require your approval before running. You'll get a push notification (server mode) or a prompt in the PWA to confirm or abort.
- **Run history** — each run produces a timestamped result file. You can view results and reports from the PWA.
- **Real-time updates** — task status changes (started, finished, failed) are pushed to connected PWA clients via NATS pub/sub (server mode) and/or SSE (LAN mode).
- **MCP server** (`palmier mcpserver`) exposes platform tools (e.g., `send-push-notification`) to AI agents like Claude Code over stdio.

## NATS Subjects

| Subject | Direction | Description |
|---|---|---|
| `host.<hostId>.rpc.<method>` | Client → Host | RPC request/reply (e.g., `task.list`, `task.create`) |
| `host-event.<hostId>.<taskId>` | Host → Client | Real-time task events (`running-state`, `confirm-request`, `permission-request`, `input-request`) |
| `host.<hostId>.push.send` | Host → Server | Request server to deliver a push notification |
| `pair.<code>` | Client → Host | OTP pairing request/reply |

## Project Structure

```
src/
  index.ts            # CLI entrypoint (commander setup)
  config.ts           # Host configuration (read/write ~/.config/palmier)
  rpc-handler.ts      # Transport-agnostic RPC handler (with session validation)
  session-store.ts    # Session token management (~/.config/palmier/sessions.json)
  nats-client.ts      # NATS connection helper
  spawn-command.ts    # Shared helper for spawning CLI tools
  task.ts             # Task file management
  types.ts            # Shared type definitions
  lan-lock.ts         # LAN lockfile path and port reader
  events.ts           # Event broadcasting (NATS pub/sub or HTTP SSE)
  agents/
    agent.ts          # AgentTool interface, registry, and agent detection
    claude.ts         # Claude Code agent implementation
    gemini.ts         # Gemini CLI agent implementation
    codex.ts          # Codex CLI agent implementation
    openclaw.ts       # OpenClaw agent implementation
  commands/
    init.ts           # Interactive setup wizard (auto-pair)
    pair.ts           # OTP code generation and pairing handler
    lan.ts            # On-demand LAN server
    sessions.ts       # Session token management CLI (list, revoke, revoke-all)
    info.ts           # Print host connection info
    agents.ts         # Re-detect installed agent CLIs
    serve.ts          # Transport selection, startup, and crash detection polling
    restart.ts        # Daemon restart (cross-platform)
    run.ts            # Single task execution
    mcpserver.ts      # MCP server with platform tools (send-push-notification)
  platform/
    platform.ts       # PlatformService interface
    index.ts          # Platform factory (Linux vs Windows)
    linux.ts          # Linux: systemd daemon, timers, systemctl task control
    windows.ts        # Windows: Registry Run key, Task Scheduler, schtasks-based task control
  transports/
    nats-transport.ts # NATS subscription loop (host.<hostId>.rpc.>)
    http-transport.ts # HTTP server with RPC, SSE, PWA reverse proxy, and internal event endpoints
```

## MCP Server

The host includes an MCP server that exposes Palmier platform tools to AI agents like Claude Code.

### Setup

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "palmier": {
      "command": "palmier",
      "args": ["mcpserver"]
    }
  }
}
```

Requires a provisioned host (`palmier init`) with server mode enabled.

### Available Tools

| Tool | Inputs | Description |
|---|---|---|
| `send-push-notification` | `title`, `body` (required) | Send a push notification to all paired devices |

## Uninstalling

To fully remove Palmier from a machine:

1. **Unpair your device** in the PWA (via the host menu).

2. **Stop and remove the daemon:**

   **Linux:**
   ```bash
   systemctl --user stop palmier.service
   systemctl --user disable palmier.service
   rm ~/.config/systemd/user/palmier.service
   ```

   **Windows (PowerShell):**
   ```powershell
   # Kill the daemon process
   Get-Content "$env:USERPROFILE\.config\palmier\daemon.pid" | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
   # Remove the Registry Run key
   Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "PalmierDaemon" -ErrorAction SilentlyContinue
   ```

3. **Remove any task timers:**

   **Linux:**
   ```bash
   systemctl --user stop palmier-task-*.timer palmier-task-*.service 2>/dev/null
   systemctl --user disable palmier-task-*.timer 2>/dev/null
   rm -f ~/.config/systemd/user/palmier-task-*.timer ~/.config/systemd/user/palmier-task-*.service
   systemctl --user daemon-reload
   ```

   **Windows (PowerShell):**
   ```powershell
   schtasks /delete /tn "PalmierTask-*" /f 2>$null
   ```

4. **Remove configuration and task data:**

   ```bash
   rm -rf ~/.config/palmier
   rm -rf tasks/   # from your Palmier root directory
   ```

## Disclaimer

**USE AT YOUR OWN RISK.** Palmier is provided on an "AS IS" and "AS AVAILABLE" basis, without warranties of any kind, either express or implied.

### AI Agent Execution

Palmier spawns third-party AI agent CLIs (such as Claude Code, Gemini CLI, and Codex CLI) that can:

- **Read, create, modify, and delete files** on your machine
- **Execute arbitrary shell commands** with your user permissions
- **Make network requests** and interact with external services

AI agents may produce unexpected, incorrect, or harmful outputs. **You are solely responsible for reviewing and approving all actions taken by AI agents on your system.** The authors of Palmier have no control over the behavior of third-party AI agents and accept no liability for their actions.

### Unattended and Scheduled Execution

Tasks can be configured to run on schedules (cron) or in response to events without active supervision. You should:

- Use the **confirmation** feature for sensitive tasks
- Restrict **permissions** granted to agents to the minimum necessary
- Regularly review **task history and results**
- Maintain **backups** of any important data in directories where agents operate

### Third-Party Services

Task prompts and execution data may be transmitted to third-party AI service providers (Anthropic, Google, OpenAI, etc.) according to their respective terms and privacy policies. Palmier does not control how these services process your data.

When using server mode, communication between your device and the host is relayed through the Palmier server. See the [Privacy Policy](https://www.palmier.me/privacy) for details on what data is collected.

### Limitation of Liability

To the maximum extent permitted by applicable law, the authors and contributors of Palmier shall not be liable for any direct, indirect, incidental, special, consequential, or exemplary damages arising from the use of this software, including but not limited to damages for loss of data, loss of profits, business interruption, or any other commercial damages or losses.

### No Professional Advice

Palmier is a developer tool, not a substitute for professional advice. Do not rely on AI-generated outputs for critical decisions without independent verification.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for the full text.
