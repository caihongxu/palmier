# Palmier

[![CI](https://github.com/caihongxu/palmier/actions/workflows/ci.yml/badge.svg)](https://github.com/caihongxu/palmier/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/palmier)](https://www.npmjs.com/package/palmier)
[![license](https://img.shields.io/npm/l/palmier)](https://github.com/caihongxu/palmier/blob/master/LICENSE)

**Website:** [palmier.me](https://www.palmier.me) | **App:** [app.palmier.me](https://app.palmier.me)

A Node.js CLI that lets you dispatch your own AI agents from your phone. It runs on your machine as a persistent daemon, letting you create, schedule, and monitor agent tasks from any device via a cloud relay (NATS) and/or direct HTTP.

> **Important:** By using Palmier, you agree to the [Terms of Service](https://www.palmier.me/terms) and [Privacy Policy](https://www.palmier.me/privacy). See the [Disclaimer](#disclaimer) section below.

## Access Modes

The serve daemon always runs a local HTTP server. Three access modes are available:

| Mode | Transport | URL | Pairing | Features |
|------|-----------|-----|---------|----------|
| **Local** | HTTP (localhost) | `http://localhost:<port>` | Not required | Full access from the host machine, no internet needed |
| **LAN** | HTTP (direct) | `http://<host-ip>:<port>` | Required | Access from other devices on the local network |
| **Server** | Cloud relay (NATS) | `https://app.palmier.me` | Required | Push notifications, remote access from anywhere |

**Local mode** is always available. The PWA is served at `http://localhost:<port>` and works without pairing or internet. The daemon binds to `127.0.0.1` by default.

**LAN mode** is enabled during `palmier init`. The daemon binds to `0.0.0.0` instead, making the PWA and API endpoints accessible from the local network at `http://<host-ip>:<port>`. Devices must pair via OTP to access. Push notifications are not available.

**Server mode** relays communication through the Palmier cloud server (via [NATS](https://nats.io), a lightweight messaging system). All features including push notifications are available. The PWA is served over HTTPS. Server mode and LAN mode can be active at the same time.

## Prerequisites

- **Node.js 24+**
- An agent CLI tool for task execution (e.g., Claude Code, Gemini CLI, OpenAI Codex, GitHub Copilot)
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
| `palmier pair` | Generate an OTP code to pair a new device |
| `palmier clients list` | List active client tokens |
| `palmier clients revoke <token>` | Revoke a specific client token |
| `palmier clients revoke-all` | Revoke all client tokens |
| `palmier info` | Show host connection info (address, mode) |
| `palmier serve` | Run the persistent RPC handler (default command) |
| `palmier restart` | Restart the palmier serve daemon |
| `palmier run <task-id>` | Execute a specific task |

## Setup

### Quick Start

1. Install the host: `npm install -g palmier`
2. Run `palmier init` in your Palmier root directory (e.g., `~/palmier`).
3. The wizard detects installed agents, configures access modes, registers with the Palmier server, and installs a background daemon.
4. Open `http://localhost:<port>` to access the app locally — no pairing needed.
5. To access from other devices, pair via `palmier pair` (run automatically after init).

### Pairing devices

Local access (`http://localhost:<port>`) works immediately — no pairing needed.

For LAN or server mode, run `palmier pair` on the host to generate an OTP code. Enter it in the PWA — either at `http://<host-ip>:<port>` (LAN mode) or `https://app.palmier.me` (server mode).

### Managing clients

```bash
# List all paired devices
palmier clients list

# Revoke a specific device's access
palmier clients revoke <token>

# Revoke all clients (unpair all devices)
palmier clients revoke-all
```

The `init` command:
- Detects installed agent CLIs (Claude Code, Gemini CLI, Codex CLI, GitHub Copilot) and caches the result
- Configures access modes (HTTP port, LAN access)
- Shows a summary and asks for confirmation before making changes
- Registers with the Palmier server, saves configuration to `~/.config/palmier/host.json`
- Installs a background daemon (systemd user service on Linux, Registry Run key on Windows)
- Auto-enters pair mode to connect your first device

Agents are re-detected on every daemon start. Run `palmier restart` after installing or removing a CLI.

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
- **Device access** — localhost is always trusted (no pairing needed). LAN and server mode devices communicate via direct HTTP or NATS respectively, and must pair via OTP to get a client token.
- **Tasks** are stored locally as Markdown files in a `tasks/` directory. Each task has a name, prompt, execution plan, and optional schedules (cron schedules or one-time dates).
- **Plan generation** is automatic — when you create or update a task, the host invokes your chosen agent CLI to generate an execution plan and name.
- **Schedules** are backed by systemd timers (Linux) or Task Scheduler (Windows). You can enable/disable them without deleting the task, and any task can still be run manually at any time.
- **Command-triggered tasks** — optionally specify a shell command (e.g., `tail -f /var/log/app.log`). Palmier runs the command continuously and invokes the agent for each line of stdout, passing it alongside your prompt. Useful for log monitoring, event-driven automation, and reactive workflows.
- **Agent HTTP endpoints** — the serve daemon exposes localhost-only endpoints (`/notify`, `/request-input`) that agents call to send push notifications and request user input during task execution.

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
