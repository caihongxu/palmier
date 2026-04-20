# Palmier

[![CI](https://github.com/caihongxu/palmier/actions/workflows/ci.yml/badge.svg)](https://github.com/caihongxu/palmier/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/palmier)](https://www.npmjs.com/package/palmier)
[![license](https://img.shields.io/npm/l/palmier)](https://github.com/caihongxu/palmier/blob/master/LICENSE)

**Website:** [palmier.me](https://www.palmier.me) | **App:** [app.palmier.me](https://app.palmier.me)

You have AI agents on your machine. But you have to sit at your desk to use them. Palmier lets you dispatch, schedule, and monitor them from any device, anywhere.

It runs on your machine as a background daemon and connects to a mobile-friendly PWA, so you can start one-off sessions, schedule recurring tasks, approve permissions, and check results without being at your computer.
> **Important:** By using Palmier, you agree to the [Terms of Service](https://www.palmier.me/terms) and [Privacy Policy](https://www.palmier.me/privacy). See the [Disclaimer](#disclaimer) section below.

## Quick Start

1. Install a supported agent CLI — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), [GitHub Copilot](https://github.com/github/gh-copilot), [OpenClaw](https://openclaw.ai/), or [others](https://www.palmier.me/agents).
2. Install Palmier:

   **Linux / macOS:**
   ```bash
   curl -fsSL https://palmier.me/install.sh | bash
   ```

   **Windows (PowerShell):**
   ```powershell
   irm https://palmier.me/install.ps1 | iex
   ```

   The one-liner installs Node.js 24+ if needed (via [fnm](https://github.com/Schniz/fnm) on Linux/macOS, winget on Windows), then `palmier` globally. If you already have Node.js 24+ and npm:
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
- **Linux with systemd**, **macOS 13+**, or **Windows 10/11**
- At least one supported agent CLI

## How It Works

Palmier runs as a background daemon (systemd on Linux, launchd on macOS, Task Scheduler on Windows). It invokes your agent CLIs directly, schedules tasks via native OS timers, and exposes an API that the PWA connects to — either directly over HTTP or remotely through a relay server. Agents can interact with the user's mobile device during execution — requesting input, sending push notifications and full-screen alarms, reading SMS/notifications, managing contacts and calendar, and more.

### MCP Server

Palmier exposes an [MCP](https://modelcontextprotocol.io) server at `http://localhost:<port>/mcp` (streamable HTTP transport). MCP-capable agents can register it to get tool and resource definitions automatically. The same tools and resources are also available as REST endpoints for curl-based agents.

**MCP server URL:** `http://localhost:<port>/mcp`

**Available tools:**
| Tool | Description | Permission |
|------|-------------|------------|
| `notify` | Send a push notification to the user's device | None |
| `request-input` | Request input from the user (blocks until response) | None |
| `request-confirmation` | Request confirmation from the user (blocks until response) | None |
| `device-geolocation` | Get GPS location of the user's mobile device | Get Location |
| `read-contacts` | Read the contact list from the user's device | Manage Contacts |
| `create-contact` | Create a new contact on the user's device | Manage Contacts |
| `read-calendar` | Read calendar events (with time range filter) | Manage Calendar |
| `create-calendar-event` | Create a calendar event on the user's device | Manage Calendar |
| `send-sms-message` | Send an SMS message from the user's device | Send SMS |
| `send-alarm` | Trigger a full-screen alarm popup with ringtone on the user's device (pierces DND) | Trigger Alarms |
| `read-battery` | Get battery level and charging status | None |
| `set-ringer-mode` | Set ringer mode (normal/vibrate/silent) | Set Ringer Mode |

**Available resources:**
| Resource | URI | Permission | Description |
|----------|-----|------------|-------------|
| Device Notifications | `notifications://device` | Notifications from Other Apps | Recent notifications from the user's Android device |
| Device SMS | `sms-messages://device` | Read SMS | Recent SMS messages from the user's Android device |

Resources support MCP subscriptions — clients can subscribe via `resources/subscribe` and receive real-time `notifications/resources/updated` events via the streamable HTTP transport when the resource changes.

All device tools work while the Palmier Android app is in the background — they communicate via FCM data messages which wake the app's service even when it's not in the foreground. Each host has one **linked device**: the phone the host uses for SMS, contacts, location, and other device capabilities. Choose it at pair time (the "Link to this device" checkbox) or later from the drawer. Permissions listed above must be granted via toggles in the linked device's drawer.

### Architecture

```
┌──────────────┐         HTTP          ┌──────────────────┐
│              │◄──────────────────────│                  │
│  Host Daemon │                       │   PWA (Browser)  │
│  (MCP Server)│◄──────┐               │                  │
└──┬────────┬──┘       │               └──────────────────┘
   │        │          │                        │
   ▼        ▼          │  NATS (TLS)            │ NATS (TLS)
┌──────┐ ┌──────┐      │               ┌────────┴─────────┐
│Agent │ │Agent │      └───────────────│  Relay Server    │
│ CLIs │ │Tools/│                       │  (passthrough,   │
│      │ │Rsrcs │◄──── FCM ───────────│   push, FCM)     │
└──────┘ └──────┘                       └──────────────────┘
                                                │
                                           FCM  │
                                                ▼
                                       ┌──────────────────┐
                                       │  Android Device  │
                                       │  (notifications, │
                                       │   SMS, contacts, │
                                       │   calendar, GPS) │
                                       └──────────────────┘
        Local mode (loopback): direct HTTP on the host machine
        Server mode: via relay (events) + auto-LAN direct HTTP for RPC when reachable (native app)
```

## Access Modes

Three ways to reach your host, ordered by setup effort:

| Mode | Where | Pairing | Notes |
|------|-------|---------|-------|
| **Local** | `http://localhost:<port>` in a browser on the host machine | Not required | Loopback only. No internet needed. |
| **Remote (web)** | [https://app.palmier.me](https://app.palmier.me) in any browser | Required | Always goes through the cloud relay. |
| **Remote (app)** | [Android APK](https://github.com/caihongxu/palmier-android/releases) | Required | Push notifications, background device capabilities, and **auto-LAN**. |

**Auto-LAN (native app only).** When the Android app is on the same network as the host, it transparently routes RPC over direct LAN HTTP (`http://<host-ip>:<port>/rpc/...`) instead of through the relay — lower latency, no protocol change. Events still flow over the relay. Pairing always goes through the relay regardless. Browser PWAs can't do this (Private Network Access / mixed-content restrictions) and stay on the relay.

## Security & Privacy

**Local mode** — all traffic stays on `127.0.0.1`. No data leaves your machine. The web UI, `/pair`, and `/events` reject any non-loopback caller; only `/rpc/<method>` (bearer-auth) and `/health` are reachable from the LAN.

**Server mode** — communication between your device and host is relayed through the Palmier cloud server over TLS-encrypted NATS connections. The server acts as a passthrough relay only — it does not store, log, or inspect any user data, task content, or agent output. The only data the server persists is a host registration ID used for message routing and Web Push subscription info for delivering notifications. See the [Privacy Policy](https://www.palmier.me/privacy) for full details.

**Auto-LAN** — direct LAN HTTP requests use the same client token (Bearer auth) generated during pairing. The host validates every `/rpc/*` call regardless of source.

In all modes, client tokens are generated and validated entirely on your host. The Palmier server never sees or stores them.

## Setup Details

### Pairing Devices

Local access (`http://localhost:<port>`) works immediately — no pairing needed.

For remote access (web or app), run `palmier pair` on the host to generate a code, then enter it at [https://app.palmier.me](https://app.palmier.me) or in the Android app. Pairing always goes through the relay; auto-LAN kicks in transparently afterward in the native app when on the same network.

### Managing Clients

```bash
# List all paired devices
palmier clients list

# Revoke a specific device's access
palmier clients revoke <token>

# Revoke all clients (unpair all devices)
palmier clients revoke-all
```

Revoking the linked device also clears the host's linked-device record; device capabilities stop working until another paired device is linked from its drawer.

### The `init` Command

The wizard:
- Detects installed agent CLIs and caches the result
- Asks for the HTTP port
- Detects the default network interface (used for auto-LAN)
- Shows a summary (including any existing scheduled tasks to recover) and asks for confirmation
- Registers with the Palmier server, saves configuration to `~/.config/palmier/host.json`
- Installs a background daemon (systemd user service on Linux, LaunchAgent on macOS, Task Scheduler on Windows)
- Auto-enters pair mode to connect your first device

The daemon automatically recovers existing tasks by reinstalling their system timers on startup.

> **macOS note:** Palmier installs as a user-level LaunchAgent, so it runs without `sudo`. LaunchAgents only run while the user is logged into the GUI session — after a reboot, scheduled tasks stay dormant until you log in at least once. Enable auto-login in System Settings → Users & Groups if you need unattended operation across reboots.

Agents are re-detected on every daemon start. Run `palmier restart` after installing or removing a CLI.

### Re-detecting the LAN Network

The default network interface is detected once during `palmier init` and saved to `host.json`. The daemon derives the current IP live from that interface on each client connect, so DHCP-assigned IP changes on the same adapter are picked up automatically. If you physically switch to a different network adapter (e.g., plug in Ethernet after running on WiFi, or add a new USB-tethered interface), run `palmier init` again to re-detect.

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

   **Linux / macOS:**
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
