# Palmier

[![CI](https://github.com/caihongxu/palmier/actions/workflows/ci.yml/badge.svg)](https://github.com/caihongxu/palmier/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/palmier)](https://www.npmjs.com/package/palmier)
[![license](https://img.shields.io/npm/l/palmier)](https://github.com/caihongxu/palmier/blob/master/LICENSE)

**Website:** [palmier.me](https://www.palmier.me) | **App:** [app.palmier.me](https://app.palmier.me)

You have AI agents on your machine. But you have to sit at your desk to use them. Palmier lets you dispatch, schedule, and monitor them from any device, anywhere.

It runs on your machine as a background daemon and connects to a mobile-friendly PWA, so you can create tasks, approve permissions, and check results without being at your computer.
> **Important:** By using Palmier, you agree to the [Terms of Service](https://www.palmier.me/terms) and [Privacy Policy](https://www.palmier.me/privacy). See the [Disclaimer](#disclaimer) section below.

## Quick Start

1. Install a supported agent CLI — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), [GitHub Copilot](https://github.com/github/gh-copilot), [OpenClaw](https://openclaw.ai/), or [others](https://www.palmier.me/agents).
2. Install Palmier:
   ```bash
   npm install -g palmier
   ```
3. Run the setup wizard from your Palmier root directory (e.g., `~/palmier`):
   ```bash
   palmier init
   ```
   This detects your agents, configures access, installs the background daemon, and starts pairing.
4. Open `http://localhost:<port>` to access the app locally — no pairing needed.
5. To access from other devices, enter the pairing code shown after init into the [PWA](https://app.palmier.me).

### Prerequisites

- **Node.js 24+**
- **Linux with systemd** or **Windows 10/11** (macOS coming soon)
- At least one supported agent CLI

## How It Works

Palmier runs as a background daemon (systemd on Linux, Task Scheduler on Windows). It invokes your agent CLIs directly, schedules tasks via native OS timers, and exposes an API that the PWA connects to — either directly over HTTP or remotely through a relay server. Agents can interact with the user's mobile device during execution — requesting input, sending push notifications, and fetching GPS location.

### MCP Server

Palmier exposes an [MCP](https://modelcontextprotocol.io) server at `http://localhost:<port>/mcp` (streamable HTTP transport). MCP-capable agents can register it to get tool definitions automatically. The same tools are also available as REST endpoints for curl-based agents.

**MCP server URL:** `http://localhost:<port>/mcp`

**Available tools:**
| Tool | Description |
|------|-------------|
| `notify` | Send a push notification to the user's device |
| `request-input` | Request input from the user (blocks until response) |
| `request-confirmation` | Request confirmation from the user (blocks until response) |
| `device-geolocation` | Get GPS location of the user's mobile device |

```
┌──────────────┐         HTTP          ┌──────────────────┐
│              │◄──────────────────────│                  │
│  Host Daemon │                       │   PWA (Browser)  │
│              │◄──────┐               │                  │
└──────┬───────┘       │               └──────────────────┘
       │               │                        │
       ▼               │  NATS (TLS)            │ NATS (TLS)
┌──────────────┐       │               ┌────────┴─────────┐
│  Agent CLIs  │       └───────────────│  Relay Server    │
│  (Claude,    │                       │  (passthrough,   │
│   Gemini,    │                       │   push notify)   │
│   Codex ...) │                       └──────────────────┘
└──────────────┘
        Local / LAN: direct HTTP
        Server mode: via relay server
```

## Access Modes

Local always works. Enable LAN and/or Server mode during `palmier init`.

| Mode | Transport | URL | Pairing | Features |
|------|-----------|-----|---------|----------|
| **Local** | HTTP (localhost) | `http://localhost:<port>` | Not required | Full access from the host machine, no internet needed |
| **LAN** | HTTP (direct) | `http://<host-ip>:<port>` | Required | Access from other devices on the local network |
| **Server** | Cloud relay (NATS) | [https://app.palmier.me](https://app.palmier.me) | Required | Push notifications, remote access from anywhere |

**LAN mode** binds the daemon to `0.0.0.0` so the PWA is accessible from other devices on your network. Devices must pair with a pairing code.

**Server mode** relays communication through the Palmier cloud server (via [NATS](https://nats.io)). All features including push notifications are available. Server mode and LAN mode can be active at the same time.

## Security & Privacy

**Local mode** — all traffic stays on `127.0.0.1`. No data leaves your machine.

**LAN mode** — traffic stays on your local network. Devices must pair with a one-time pairing code before they can access the host. Unpaired requests are rejected.

**Server mode** — communication between your device and host is relayed through the Palmier cloud server over TLS-encrypted NATS connections. The server acts as a passthrough relay only — it does not store, log, or inspect any user data, task content, or agent output. The only data the server persists is a host registration ID used for message routing and Web Push subscription info for delivering notifications. See the [Privacy Policy](https://www.palmier.me/privacy) for full details.

In all modes, client tokens are generated and validated entirely on your host. The Palmier server never sees or stores them.

## Setup Details

### Pairing Devices

Local access (`http://localhost:<port>`) works immediately — no pairing needed.

For LAN or server mode, run `palmier pair` on the host to generate a pairing code. Enter it in the PWA — either at `http://<host-ip>:<port>` (LAN mode) or [https://app.palmier.me](https://app.palmier.me) (server mode).

### Managing Clients

```bash
# List all paired devices
palmier clients list

# Revoke a specific device's access
palmier clients revoke <token>

# Revoke all clients (unpair all devices)
palmier clients revoke-all
```

### The `init` Command

The wizard:
- Detects installed agent CLIs and caches the result
- Configures access modes (HTTP port, LAN access)
- Shows a summary (including any existing scheduled tasks to recover) and asks for confirmation
- Registers with the Palmier server, saves configuration to `~/.config/palmier/host.json`
- Installs a background daemon (systemd user service on Linux, Task Scheduler on Windows)
- Auto-enters pair mode to connect your first device

The daemon automatically recovers existing tasks by reinstalling their system timers on startup.

Agents are re-detected on every daemon start. Run `palmier restart` after installing or removing a CLI.

## CLI Reference

| Command | Description |
|---|---|
| `palmier init` | Interactive setup wizard |
| `palmier pair` | Generate a pairing code to pair a new device |
| `palmier clients list` | List active client tokens |
| `palmier clients revoke <token>` | Revoke a specific client token |
| `palmier clients revoke-all` | Revoke all client tokens |
| `palmier info` | Show host connection info (address, mode) |
| `palmier serve` | Run the persistent RPC handler (default command) |
| `palmier restart` | Restart the palmier serve daemon |
| `palmier run <task-id>` | Execute a specific task |
| `palmier uninstall` | Stop daemon and remove all scheduled tasks |

## Uninstalling

To fully remove Palmier from a machine:

1. **Unpair your device** in the PWA (via the host menu).

2. **Stop the daemon and remove all scheduled tasks:**

   ```bash
   palmier uninstall
   ```

3. **Uninstall the package:**

   ```bash
   npm uninstall -g palmier
   ```

4. **(Optional) Remove configuration and task data:**

   **Linux:**
   ```bash
   rm -rf ~/.config/palmier
   rm -rf ~/palmier   # or wherever your Palmier root directory is
   ```

   **Windows (PowerShell):**
   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.config\palmier"
   Remove-Item -Recurse -Force "$env:USERPROFILE\palmier"   # or wherever your Palmier root directory is
   ```

## Disclaimer

Palmier spawns AI agents that can read, write, and execute on your machine. [Read the full disclaimer](DISCLAIMER.md) before use.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for the full text.
