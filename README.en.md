# Star Sanctuary

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md"><b>English</b></a>
</p>

<p align="center">
  <strong>Local-first personal AI assistant and Agent workspace</strong><br>
  Runs on your own machine with WebChat, CLI, multi-channel access, memory, tools, automation, and long-term workspace capabilities.<br>
  <span style="color:#ff4d4f;font-weight:bold;">Important notice: Star Sanctuary has local execution, file editing, browser control, and external integration capabilities. Enable high-privilege features only after you understand the boundaries, preferably in a controlled environment with proper backups.</span>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#core-capabilities">Core Capabilities</a> •
  <a href="#project-structure">Project Structure</a> •
  <a href="#personalization-and-long-term-capabilities">Personalization</a> •
  <a href="#long-term-goals-quick-entry">Long-term Goals</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#channels-and-integrations">Channels</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#faq">FAQ</a> •
  <a href="#sponsorship">Sponsorship</a>
</p>

---

## Introduction

Star Sanctuary is a **local-first** personal AI assistant project. It is built around a local Gateway that unifies model calls, long-term workspace files, memory retrieval, tool execution, chat channels, browser automation, and scheduled tasks into one runtime.

This repository is no longer just a WebChat demo. It is now a full Agent infrastructure stack:

- **Local-first**: the default state directory is the `.star_sanctuary` folder under your user home directory, with compatibility for the legacy `.belldandy` folder  
  On Windows, the common path is: `C:\Users\YourName\.star_sanctuary`
- **Unified entrypoints**: WebChat, `bdd` CLI, chat channels, webhooks, and community APIs share the same Agent and tool system
- **Long-term workspace**: built-in workspace files such as `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, and `AGENTS.md`
- **Extensible by design**: supports Skills, Methods, Plugins, MCP, Browser Relay, Channels Router, and multi-Agent Profiles

### Design Principles

- **Privacy-first**: runs locally by default and keeps your data and workspace under your control
- **Secure defaults**: public binding requires authentication; client messages require pairing; tools are guarded by policies and allowlists
- **Long-term companionship**: this is not just one-shot Q&A, but an Agent with memory, methodology, logs, and automation

### Tech Stack

| Category | Tech |
|------|------|
| Language | TypeScript |
| Runtime | Node.js 22.12+ |
| Package manager | pnpm Workspace |
| Transport | WebSocket + HTTP API |
| Data | SQLite / FTS5 / sqlite-vec |
| Frontend | Vanilla HTML / JS / CSS |
| Browser automation | Chrome Extension (MV3) + Relay |
| Voice | TTS / STT |
| Extension protocol | MCP |

### Standard Client Download

For non-technical general users, the project's community website provides a standard, easy-to-use client for download.

- **Community Website**: [https://www.goddess-ai.top](https://www.goddess-ai.top)

Current standard package policy:

- `Portable`: available in `Slim` and `Full`
- `Single-Exe`: currently available as `Windows x64 + Full`
- `Single-Exe Full` currently ships with:
  - `star-sanctuary-single.exe`
  - `single-exe.json`
  - `README-single-exe.md`
  - `README-single-exe-zh.md`
  - `.env.example`
- On first launch, `Single-Exe` extracts its runtime into the Windows local app data directory under `StarSanctuary\runtime\<version>-win32-x64`  
  On Windows, the common path is: `C:\Users\YourName\AppData\Local\StarSanctuary\runtime\<version>-win32-x64`

> **The community website is more than just a download page; it features a rich ecosystem of modules:**
> - **Co-Lab**: A hub for publishing tasks and accepting assignments
> - **Town Square**: A plaza for public interaction and personal domain showcases
> - **Workshop**: Discover, publish, and run various Agent Apps and modules
> - **Community Rooms**: Interact with Agents, manage configurations, and set API Keys

### Tutorials and Videos

To keep this README concise, full usage guides, installation walkthroughs, configuration tutorials, troubleshooting instructions, and update overviews are not all embedded here.

Related tutorial videos will be published on the author's Bilibili homepage:

- https://space.bilibili.com/26585867?spm_id_from=333.1007.0.0

---

## At-a-Glance

If you just need to know which entrypoint to use first, start with this table:

| What you want to do | Primary entrypoint | Secondary entrypoint | Quick note |
|---|---|---|---|
| Install / upgrade from terminal | `install.ps1` / `install.sh` | `release-light` release asset | The installer now prefers the `release-light` asset set first; manual deploys should also prefer `star-sanctuary-dist-v<version>.*`. |
| Chat with the Agent | WebChat | `/api/message` | For normal use, start in WebChat. |
| Change model / API key / capability toggles | WebChat `⚙️ Settings` | `bdd config set` | Regular users should prefer Settings; use CLI for scripted changes. |
| Pair a new device | Get pairing code in WebChat | `bdd pairing approve` | WebChat triggers the flow, CLI approves it. |
| Review memories, task records, experience candidates | WebChat `🧠 Memory Viewer` | — | Best place for review and memory inspection. |
| Manage long-term goals | WebChat `🎯 Goals` | — | Main entrypoint for long-running work. |
| Break down tasks or inspect ReAct visually | WebChat `Canvas` | — | Best for visual planning and structured breakdown. |
| Temporarily disable tools / MCP / plugins | WebChat `🛠️ Tool Settings` | `tools.list` | This is runtime policy, not uninstall. |
| Check whether the system is healthy | `corepack pnpm bdd doctor` | `system.doctor` | `bdd doctor` is static health; `system.doctor` is runtime health. |
| Install / update / uninstall extensions | `bdd marketplace ...` | — | Extension installation currently lives primarily in CLI; `directory` is the most solid source type. |
| Integrate external systems | `/api/message` / `/api/webhook/:id` | `message.send` | Prefer HTTP / RPC for automation, webhooks, and integrations. |

Fast rule of thumb:

- For usage: start with `WebChat`
- For config and operations: start with `CLI`
- For integrations and troubleshooting: start with `RPC / HTTP + system.doctor`

---

## Core Capabilities

### 1. Gateway + WebChat + CLI

- Local Gateway, default address: `http://127.0.0.1:28889`
- WebChat with streaming replies, configuration management, tool toggles, and workspace editing
- `bdd` CLI with `start / stop / status / doctor / setup / pairing / config / relay / community`
- Foreground mode, background daemon mode, and `GET /health` health check

### 2. Agent Runtime

- OpenAI-compatible provider support
- Both `chat_completions` and `responses` API paths
- Primary model plus `models.json` fallback queue
- Automatic context compaction
- Multi-Agent Profiles, Agent Registry, and per-channel / per-rule routing

For `agents.json` field semantics, implicit `default` behavior, tool permission boundaries, and workspace inheritance rules, see:

- [docs/agents.json配置说明.md](./docs/agents.json%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)

### 3. Memory and Long-term Workspace

- Hybrid retrieval with SQLite + FTS5 + sqlite-vec
- Embedding retrieval, local workspace file loading, and session persistence
- Methods documents, logs playback, and memory file directories
- Supports `agents/{agentId}` sub-workspaces and `facets/` module switching

### 4. Tool System

Built-in tools currently cover:

- File read/write, directory listing, patch apply, web fetch, and web search
- System commands, process management, terminal, and code interpreter
- Memory search, log reading, methodology read/write, task delegation, and parallel subtasks
- Browser open / navigate / click / type / screenshot / snapshot
- TTS, STT, image generation, and camera capture
- Timers, token counters, cron scheduling, and service restart
- Skills lookup, canvas workspace, identity context, community room actions, and office / homestead tools

### 5. Channels and External Integrations

- WebChat
- Feishu
- QQ
- Discord
- `community` persistent community connection
- `/api/message` community HTTP API
- `/api/webhook/:id` webhook API
- Channels Router

### 6. Deployment and Operations

- One-click launch via `start.bat` / `start.sh`
- Docker / Docker Compose
- Tailscale remote access
- Nix deployment
- `bdd doctor` health checks

---

## Project Structure

```text
star-sanctuary/
├── apps/
│   ├── web/                         # WebChat frontend
│   └── browser-extension/          # Chrome extension for Browser Relay
├── packages/
│   ├── belldandy-protocol/         # Protocol, state-dir resolution, shared types
│   ├── belldandy-core/             # Gateway, CLI, logs, Heartbeat, Cron, Webhook
│   ├── belldandy-agent/            # Agent runtime, prompts, compaction, multi-Agent
│   ├── belldandy-memory/           # SQLite / FTS / vector retrieval / memory management
│   ├── belldandy-skills/           # Built-in tools, Skills, Browser, Methods, Office
│   ├── belldandy-channels/         # Feishu / QQ / Discord / Community / Router
│   ├── belldandy-mcp/              # MCP integration
│   ├── belldandy-plugins/          # Plugin system
│   └── belldandy-browser/          # Browser Relay
├── docs/                           # Deployment, webhook, routing, design docs
├── examples/                       # Methods, skills, facets, and Agent examples
├── start.bat
├── start.sh
├── DOCKER_DEPLOYMENT.md
└── README.md
```

### Default State Directory

The default state directory is the `.star_sanctuary` folder under your user home directory. On Windows, the common path is: `C:\Users\YourName\.star_sanctuary`.  
If that does not exist but the legacy `.belldandy` folder does, the system will automatically use the legacy directory for compatibility.

Typical contents:

```text
your-home/.star_sanctuary/
├── AGENTS.md
├── SOUL.md
├── TOOLS.md
├── IDENTITY.md
├── USER.md
├── HEARTBEAT.md
├── BOOTSTRAP.md
├── MEMORY.md                       # optional
├── agents/                         # multi-Agent sub-workspaces
├── facets/                         # FACET modules
├── methods/                        # SOP / methodology
├── sessions/                       # persisted sessions
├── generated/                      # runtime-generated assets
├── logs/                           # logs
├── models.json                     # fallback model config
├── mcp.json                        # MCP config
├── webhooks.json                   # Webhook config
├── channels-routing.json           # channel routing rules
├── allowlist.json                  # paired client allowlist
└── pairing.json                    # pending pairing requests
```

---

## Personalization and Long-term Capabilities

### FACET Module System

FACET is the persona / role module system in Belldandy. Instead of putting every behavior rule into a single `SOUL.md`, you can split different styles and responsibilities into dedicated modules and switch when needed.

- Module files live under the `.star_sanctuary\facets` folder in your user home directory  
  On Windows, the common path is: `C:\Users\YourName\.star_sanctuary\facets`
- Useful for roles such as coder, researcher, translator, or writer
- Switch with the `switch_facet` tool; the change then applies under the current workspace rules
- In multi-Agent setups, FACET can also work together with `agents/{agentId}` sub-workspaces

For examples, see [`examples/facets`](./examples/facets).

### Methodology System

Methods are not just a tool list. They are the SOPs that the Agent gradually accumulates for how similar work should be done next time.

- Method documents live under the `.star_sanctuary\methods` folder in your user home directory  
  On Windows, the common path is: `C:\Users\YourName\.star_sanctuary\methods`
- The Agent can read and write them via `method_list`, `method_read`, `method_create`, and `method_search`
- Methods can work together with logs, memory, Heartbeat, and Cron to form a loop of execution -> review -> distillation -> reuse
- Good for deployment flows, channel integrations, operational SOPs, troubleshooting procedures, and content production workflows

In short:

- Skills answer "what the Agent can do"
- Methods answer "how it should do it next time"
- Logs answer "what actually happened before"

### Official Community Ecosystem Capabilities

Star Sanctuary is already integrated with the official community ecosystem. The current online service address is `https://api.goddess-ai.top`; it is not only a chat frontend, but can also work with community, workshop, and homestead modules.

- `bdd community` configures community access and room connections
- Built-in Workshop tools support search, inspect, download, publish, update, and delete flows
- Built-in Homestead tools support status lookup, inventory, claim, place, recall, mount, unmount, and blind-box actions
- Can work together with community identity, room context, and token usage upload for a unified experience

If you use Belldandy inside the community ecosystem long-term, this is part of the core workflow rather than an extra add-on.

---

## Quick Start

### Requirements

- OS: Windows / macOS / Linux
- Node.js: **22.12.0 or later**. Node 24.x is currently not recommended.
- Node.js download address: https://nodejs.org/en
- Package manager: `pnpm` via `corepack`

### Getting the Code

You can get the project in one of three ways:

**Method 0: Installer edition (one command in terminal)**

Best for users who want a direct install now and later upgrades through the same command path:

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.ps1 | iex
```

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.sh | bash
```

The installer prepares dependencies, build artifacts, launcher scripts, and the `bdd` command wrapper automatically. For advanced usage such as pinning a version, skipping setup, or forcing setup again, see:

- [docs/用户版本升级手册.md](./docs/%E7%94%A8%E6%88%B7%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E6%89%8B%E5%86%8C.md)

Current installer behavior:

- the installer now prefers `release-light` GitHub Release assets first
- if a target older release does not provide `release-light`, it automatically falls back to the source archive path
- `QuickStart` no longer asks for `provider / API Base URL / API Key / model` in CLI
- after install, go through `start.bat` / `start.sh` into WebChat and finish model/API setup in `⚙️ Settings`
- `Advanced` now keeps deployment-oriented items only, such as `host / port / auth`
- advanced modules such as `community / webhook / cron` are no longer entered during install; configure them later with `bdd configure ...`

**Method 1: Download the lightweight release asset (Recommended for manual deployment)**
1. Visit the project's [Releases page](https://github.com/vrboyzero/star-sanctuary/releases).
2. Download the current lightweight release asset for your platform:
   - Windows: `star-sanctuary-dist-v<version>.zip`
   - Linux / macOS: `star-sanctuary-dist-v<version>.tar.gz`
3. Extract it to a path without special characters or spaces.
4. Make sure Node.js 22 is already installed, then run:
   - Windows: `start.bat`
   - Linux / macOS: `./start.sh`

Notes:

- this lightweight asset already includes built `dist`, web static assets, templates, startup scripts, and `.env.example`
- it does **not** include Node runtime or `node_modules`
- startup scripts auto-run `corepack pnpm install` if dependencies are missing
- GitHub-generated `Source code (zip/tar.gz)` archives are still available, but they are no longer the README-recommended manual deployment entrypoint

**Method 2: Git Clone**
```bash
git clone https://github.com/vrboyzero/star-sanctuary.git
cd star-sanctuary
```

### Configure Environment Files

For source-mode installs, **new users usually do not need to copy `.env.example` manually**.

Current default behavior:

- on first launch, the Gateway auto-generates a default `.env` under `stateDir`
- sensitive values and personal overrides continue to live in `.env.local`
- `.env` and `.env.local` are local-only and must not be committed

To make the rest of this README easier to follow:

- **state directory**: the main directory where the app keeps configs, logs, sessions, skills, and JSON state files; some places call this `stateDir`
- **config file location**: in the current runtime, `.env / .env.local` also live directly under `stateDir`; there is no separate runtime `envDir` anymore
- **`.star_sanctuary` under your home directory**: on Windows, this is usually `C:\Users\YourName\.star_sanctuary`

The current rule is now:

1. resolve `stateDir` from `BELLDANDY_STATE_DIR` and related platform-specific variables
2. always read `.env / .env.local` from `stateDir`
3. by default, `stateDir` is usually the `.star_sanctuary` folder under your home directory

If you need to redirect the state directory before the runtime starts reading `stateDir/.env`, you can add a small bootstrap hint file:

```text
<homeDir>/.star_sanctuary-bootstrap/.env.local
```

Common Windows path:

```text
C:\Users\YourName\.star_sanctuary-bootstrap\.env.local
```

This file only handles early `stateDir` bootstrap. It should normally contain only one of these variables:

```env
BELLDANDY_STATE_DIR=H:\.star_sanctuary
# BELLDANDY_STATE_DIR_WINDOWS=C:\Users\your-name\.star_sanctuary
# BELLDANDY_STATE_DIR_WSL=~/.star_sanctuary
```

Important:

- `.star_sanctuary-bootstrap/.env.local` is not a full runtime config entrypoint
- keep model, port, logging, channel, and API key settings in the final `stateDir/.env` and `stateDir/.env.local`
- if this bootstrap file does not exist, the runtime still falls back to the normal default `~/.star_sanctuary`

Notes:

- there is no separate runtime `envDir` anymore
- project-root `.env / .env.local` should no longer be treated as the normal runtime config entrypoint
- place new config directly in `stateDir/.env` and `stateDir/.env.local`

### One-click Launch

**Windows**
Double-click `start.bat` in the install directory,
or run:

```powershell
.\start.bat
```

**macOS / Linux**

```bash
./start.sh
```

The launcher script will automatically:

- check Node.js and pnpm
- run `corepack pnpm install` if dependencies are missing
- run `corepack pnpm build` if `dist/` is missing
- auto-generate a default `.env` under `stateDir` when it is missing
- generate a one-time WebChat token when needed
- start the Gateway and open the browser

### Manual Start

```bash
# 1. Install dependencies
corepack pnpm install

# 2. Build
corepack pnpm build

# If build artifacts are inconsistent, do a clean rebuild
corepack pnpm rebuild

# 3. Health check (recommended)
corepack pnpm bdd doctor

# 4. Start in development mode
corepack pnpm bdd dev

# Or start in foreground production mode
corepack pnpm bdd start

# Or start as a background daemon
corepack pnpm bdd start -d

# Check status / stop
corepack pnpm bdd status
corepack pnpm bdd stop
```

### First-time Setup

If sensitive config is not set yet, start with:

```bash
corepack pnpm bdd setup
```

`bdd setup` writes into `stateDir/.env.local`. You can confirm the active path with:

```bash
corepack pnpm bdd config path
corepack pnpm bdd doctor
```

Current interactive `bdd setup` behavior:

- `QuickStart` handles deployment-oriented setup only and no longer asks for provider / API Base URL / API Key / model in CLI
- `Advanced` keeps extra deployment fields such as `host / port / auth`
- after setup, launch `start.bat` / `start.sh` and finish model/API configuration in WebChat `⚙️ Settings`
- advanced modules such as `community / webhook / cron / models fallback` should be maintained later with `bdd configure ...` when needed

If you are doing scripted bootstrap or automated pre-seeding, you can still use non-interactive mode:

```bash
corepack pnpm bdd setup \
  --provider openai \
  --base-url https://api.openai.com/v1 \
  --api-key sk-xxx \
  --model gpt-4o \
  --auth-mode token \
  --auth-secret your-token
```

### First-time Pairing

The Web client requires pairing on first connection. The page will show a pairing code such as `ABC123XY`.

Approve it in a terminal:

```bash
corepack pnpm bdd pairing approve ABC123XY
```

Useful pairing commands:

```bash
corepack pnpm bdd pairing pending
corepack pnpm bdd pairing list
corepack pnpm bdd pairing revoke <CLIENT_ID>
corepack pnpm bdd pairing cleanup --dry-run
corepack pnpm bdd pairing export --out pairing-backup.json --include-pending
corepack pnpm bdd pairing import --in pairing-backup.json --mode merge
```

### Cloud Server / Headless Server Deployment

Cloud servers usually do not have a usable desktop browser. The recommended setup is to keep the Gateway bound to the remote loopback address and access WebChat from your own machine through an SSH tunnel instead of exposing WebChat directly to the public internet.

On Linux/macOS installer installs, the default install root is usually `${XDG_DATA_HOME:-$HOME/.local/share}/star-sanctuary`. The examples below use `<InstallRoot>` for that directory. In source mode, replace `<InstallRoot>/bdd` with `corepack pnpm bdd`.

Configure the server:

```bash
<InstallRoot>/bdd config path
<InstallRoot>/bdd config set BELLDANDY_HOST 127.0.0.1
<InstallRoot>/bdd config set BELLDANDY_PORT 28889
<InstallRoot>/bdd config set BELLDANDY_AUTH_MODE token
<InstallRoot>/bdd config set BELLDANDY_AUTH_TOKEN '<strong-random-token>'
<InstallRoot>/start.sh
```

Create the tunnel from your local machine:

```bash
ssh -L 28889:127.0.0.1:28889 user@server
```

Then open `http://127.0.0.1:28889/` in your local browser. In the WebChat Auth controls, select `token` and enter the same token configured on the server. If a sensitive action asks for a pairing code, approve it on the server:

```bash
<InstallRoot>/bdd pairing pending
<InstallRoot>/bdd pairing approve <CODE>
```

If you must expose the service directly to a network or the public internet, use at least:

```env
BELLDANDY_HOST=0.0.0.0
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

Public exposure should also use firewall rules, a TLS reverse proxy, `BELLDANDY_ALLOWED_ORIGINS`, and a conservative tools policy. The project intentionally rejects `0.0.0.0 + AUTH_MODE=none`.

---

## Configuration

The runtime configuration path is now unified with `stateDir`.

Resolution rule:

1. resolve `stateDir`
2. then read `stateDir/.env` and `stateDir/.env.local`

Recommended mental model:

- `.env`: baseline defaults, auto-generated when missing
- `.env.local`: user secrets and machine-specific overrides

To check which config location is active:

```bash
corepack pnpm bdd config path
corepack pnpm bdd doctor
```

`bdd doctor` and `system.doctor` should both be read as state-dir based config diagnostics.

### Minimal Configuration

These values are typically written into `stateDir/.env.local`:

```env
BELLDANDY_AGENT_PROVIDER=openai
BELLDANDY_OPENAI_BASE_URL=https://api.openai.com/v1
BELLDANDY_OPENAI_API_KEY=sk-xxxxxxxx
BELLDANDY_OPENAI_MODEL=gpt-4o
```

### Common Base Configuration

These values can live in `stateDir/.env.local`, or in `stateDir/.env` as overrides:

```env
# Host and port
BELLDANDY_HOST=127.0.0.1
BELLDANDY_PORT=28889

# Auth mode: none | token | password
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token

# State dir (default: the .star_sanctuary folder under your home directory)
# BELLDANDY_STATE_DIR=E:/star_sanctuary
# Split Windows / WSL runtime state (optional, higher priority than BELLDANDY_STATE_DIR)
# BELLDANDY_STATE_DIR_WINDOWS=C:/Users/your-name/.star_sanctuary
# BELLDANDY_STATE_DIR_WSL=~/.star_sanctuary
```

### Model and Request Path

```env
# OpenAI-compatible API shape: chat_completions | responses
BELLDANDY_OPENAI_WIRE_API=chat_completions

# Stream output
BELLDANDY_OPENAI_STREAM=true

# Retry and warmup
BELLDANDY_OPENAI_MAX_RETRIES=1
BELLDANDY_OPENAI_RETRY_BACKOFF_MS=300
BELLDANDY_PRIMARY_WARMUP_ENABLED=true
BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS=8000
BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS=60000
```

`responses` is typically used for models that require that API shape, such as some Codex-style providers.

### Memory, Tools, and Workspace

```env
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=openai
BELLDANDY_EMBEDDING_MODEL=text-embedding-3-large

# Extra workspace roots (comma-separated)
# BELLDANDY_EXTRA_WORKSPACE_ROOTS=E:/project-a,E:/project-b

# Custom tools policy file
# BELLDANDY_TOOLS_POLICY_FILE=./config/tools-policy.json
```

The repository now includes three built-in tools policy examples:

- `config/tools-policy.strict.json`: most restrictive
- `config/tools-policy.balanced.json`: recommended default
- `config/tools-policy.open.json`: controlled-open profile

Start with `balanced` unless you explicitly need broader command execution, MCP, browser automation, or webhook-facing integrations.

### Scheduled Tasks and Context Compaction

```env
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_HEARTBEAT_INTERVAL=30m
BELLDANDY_HEARTBEAT_ACTIVE_HOURS=08:00-23:00

BELLDANDY_CRON_ENABLED=true

BELLDANDY_COMPACTION_ENABLED=true
BELLDANDY_COMPACTION_TRIGGER_FRACTION=0.75
BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD=2000
```

### Browser Automation

```env
BELLDANDY_BROWSER_RELAY_ENABLED=true
BELLDANDY_RELAY_PORT=28892

# Browser domain scope limits (recommended together with Relay)
# BELLDANDY_BROWSER_ALLOWED_DOMAINS=github.com,developer.mozilla.org,docs.example.com
# BELLDANDY_BROWSER_DENIED_DOMAINS=mail.google.com,drive.google.com,onedrive.live.com
```

### Configuration Guides

If you are tightening environment variables or doing a pre-release review, read these together:

- [docs/security-config-guide.en.md](./docs/security-config-guide.en.md)
- [docs/memory-token-config-guide.en.md](./docs/memory-token-config-guide.en.md)

Recommended reading order:

- Read `security-config-guide.en.md` first for host binding, auth, tool permissions, file boundaries, and external exposure
- Then read `memory-token-config-guide.en.md` for memory retrieval, compaction, and token-cost tuning

### Migrating Legacy Project-root Config to the State Directory

If you have been maintaining `.env` / `.env.local` in the project root, move them into `stateDir` as soon as possible.

When you are ready to switch to the state directory, use:

```bash
corepack pnpm bdd doctor
corepack pnpm bdd config migrate-to-state-dir --dry-run
corepack pnpm bdd config migrate-to-state-dir
corepack pnpm bdd doctor
```

After migration:

- keep maintaining only `stateDir/.env` and `stateDir/.env.local`
- stop treating project-root config files as the runtime source of truth

### Multi-channel Configuration

```env
# Feishu
BELLDANDY_FEISHU_APP_ID=
BELLDANDY_FEISHU_APP_SECRET=
BELLDANDY_FEISHU_AGENT_ID=default

# QQ
BELLDANDY_QQ_APP_ID=
BELLDANDY_QQ_APP_SECRET=
BELLDANDY_QQ_AGENT_ID=default
BELLDANDY_QQ_SANDBOX=true

# Discord
BELLDANDY_DISCORD_ENABLED=true
BELLDANDY_DISCORD_BOT_TOKEN=
```

### Channel Routing, Community, and Webhook

```env
BELLDANDY_CHANNEL_ROUTER_ENABLED=true
BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH=C:/Users/your-name/.star_sanctuary/channels-routing.json
BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID=default

BELLDANDY_COMMUNITY_API_ENABLED=false
BELLDANDY_COMMUNITY_API_TOKEN=your-community-token

BELLDANDY_WEBHOOK_CONFIG_PATH=C:/Users/your-name/.star_sanctuary/webhooks.json
BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS=600000
```

### Fallback Model Config: `models.json`

`models.json` lives at `.star_sanctuary\models.json` under your user home directory by default and defines fallback models.  
On Windows, the common path is: `C:\Users\YourName\.star_sanctuary\models.json`

```json
{
  "fallbacks": [
    {
      "id": "backup",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-xxx",
      "model": "deepseek-chat",
      "protocol": "openai",
      "wireApi": "chat_completions",
      "thinking": {
        "type": "enabled"
      },
      "reasoningEffort": "max",
      "requestTimeoutMs": 60000,
      "maxRetries": 1,
      "retryBackoffMs": 300
    }
  ]
}
```

---

## Channels and Integrations

### WebChat

After the Gateway starts, open:

- `http://127.0.0.1:28889`
- or your configured `BELLDANDY_HOST:PORT`

### Feishu / QQ / Discord

Once credentials are configured, the Gateway will initialize these channels automatically at startup.

Reference:

- [Star Sanctuary渠道对接说明.md](./Star%20Sanctuary渠道对接说明.md)

### Community Access

Community integration has its own setup wizard:

```bash
corepack pnpm bdd community
```

It manages the community connection config and supports API keys, room names, and room passwords for different Agents.

### Channels Router

`channels-routing.json` lets you route messages to different Agents based on channel, room, keywords, mention requirements, and more.

See:

- [docs/channels-routing.md](./docs/channels-routing.md)

If you also need channel-level safety defaults such as DM allowlists, mention gates, and the approval flow, see:

- [docs/channel-security配置说明.md](./docs/channel-security%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)

### Community HTTP API

When `BELLDANDY_COMMUNITY_API_ENABLED=true` is enabled, you can use:

```text
POST /api/message
```

This is mainly for community or external-service integration with the Gateway, using Bearer Token auth.

### Webhook API

Webhooks use a dedicated `webhooks.json` file under the `.star_sanctuary` folder in your user home directory.  
On Windows, the common path is: `C:\Users\YourName\.star_sanctuary\webhooks.json`  
It supports:

- per-webhook tokens
- explicit `agentId`
- auto-generated `conversationId`
- `X-Idempotency-Key` for idempotency

Endpoint:

```text
POST /api/webhook/:id
```

See:

- [docs/webhook.md](./docs/webhook.md)

---

## Browser Automation

Star Sanctuary browser automation has two parts:

- the local Relay Server
- the Chrome extension in `apps/browser-extension`

Both need to be ready before the Agent can control your real browser session and logged-in pages.

### 1. Start Relay

The simplest way:

```bash
corepack pnpm bdd relay start --port 28892
```

Or let Gateway start Relay automatically:

```env
BELLDANDY_BROWSER_RELAY_ENABLED=true
BELLDANDY_RELAY_PORT=28892
```

> By default, the extension connects to `ws://127.0.0.1:28892/extension`. If you change the Relay port, the extension side must use the same port.

### 2. Install the Chrome Extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select [`apps/browser-extension`](./apps/browser-extension)

After installation, you should see the `Star Sanctuary Browser Relay` icon in the Chrome toolbar.

### 3. First Connection

1. Make sure Relay is already running
2. Click the extension icon in the browser toolbar once
3. The extension will try to connect to the local Relay and keep the connection alive in the background

The current extension badge states are roughly:

- `ON`: connected
- `OFF`: disconnected
- `ERR`: connection failed
- `...`: connecting

### 4. How to Verify It Works

- the extension badge shows `ON`
- Gateway / Relay logs show that the extension connected
- the Agent can use browser tools such as open page, screenshot, click, type, and snapshot extraction

### 5. Typical Usage Tips

- Open a site you are already logged into, then let the Agent take over
- If you do not want the WebChat tab to be navigated accidentally, prefer using `browser_open` to create a new tab
- If connection fails, first check that local port 28892 is not occupied, then click the extension icon again

### 6. Installation Summary

1. Start Relay
2. Load [`apps/browser-extension`](./apps/browser-extension) from `chrome://extensions`
3. Click the extension icon to connect
4. Use browser tools from chat

Extension documentation:

- [apps/browser-extension/README.md](./apps/browser-extension/README.md)

---

## Deployment

### Docker / Compose

Shortest path:

```bash
cp .env.example .env
docker compose up -d belldandy-gateway
```

The project-root `.env` here is the Docker / Compose deployment file used by `docker compose` and container startup. It is separate from the `.env` inside the runtime configuration directory that source-mode / desktop-mode launches auto-bootstrap.

Full deployment, images, persistence paths, and Tailscale sidecar docs:

- [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)
- [DOCKER_HUB_README.md](./DOCKER_HUB_README.md)

### Tailscale

- [docs/TAILSCALE_DEPLOYMENT.md](./docs/TAILSCALE_DEPLOYMENT.md)

### Nix

- [docs/NIX_DEPLOYMENT.md](./docs/NIX_DEPLOYMENT.md)

---

## CLI Commands

```bash
# Root help
corepack pnpm bdd --help

# Service management
corepack pnpm bdd start
corepack pnpm bdd start -d
corepack pnpm bdd status
corepack pnpm bdd stop

# Setup and diagnostics
corepack pnpm bdd setup
corepack pnpm bdd doctor
corepack pnpm bdd doctor --check-model

# Pairing management
corepack pnpm bdd pairing pending
corepack pnpm bdd pairing approve <CODE>
corepack pnpm bdd pairing revoke <CLIENT_ID>

# Config file management
corepack pnpm bdd config path
corepack pnpm bdd config list
corepack pnpm bdd config list --show-secrets
corepack pnpm bdd config get <KEY>
corepack pnpm bdd config set <KEY> <VALUE>
corepack pnpm bdd config edit

# Browser Relay
corepack pnpm bdd relay start --port 28892

# Community setup wizard
corepack pnpm bdd community
```

---

## Long-term Goals Quick Entry

If you plan to use the built-in Long-term Goals system, start with:

- [docs/长期任务使用指南.md](./docs/%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [docs/超长期任务系统实现方案.md](./docs/%E8%B6%85%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E7%B3%BB%E7%BB%9F%E5%AE%9E%E7%8E%B0%E6%96%B9%E6%A1%88.md)

### Minimal Long-term Goals Checklist

1. Configure the minimum runtime environment:

   ```env
   BELLDANDY_AGENT_PROVIDER=openai
   BELLDANDY_OPENAI_BASE_URL=https://api.openai.com/v1
   BELLDANDY_OPENAI_API_KEY=<your-api-key>
   BELLDANDY_OPENAI_MODEL=<your-model>
   BELLDANDY_TOOLS_ENABLED=true
   BELLDANDY_CRON_ENABLED=true
   ```

2. Optionally but strongly recommended, create an org-level governance config:

   - `.star_sanctuary\governance\review-governance.json` under your user home directory  
     On Windows, the common path is: `C:\Users\YourName\.star_sanctuary\governance\review-governance.json`

   Minimal example:

   ```json
   {
     "version": 1,
     "reviewers": [
       {
         "id": "producer",
         "name": "Producer",
         "reviewerRole": "owner",
         "channels": ["reviewer_inbox"],
         "active": true
       }
     ],
     "templates": [],
     "defaults": {
       "reminderMinutes": [240, 60, 15],
       "notificationChannels": ["goal_detail", "reviewer_inbox"]
     },
     "updatedAt": "2026-03-21T00:00:00.000Z"
   }
   ```

3. Create a long-term goal:

   - WebChat → Goals panel
   - or tool `goal_init`
   - or RPC `goal.create`

4. Split the task graph, then execute nodes:

   - `task_graph_create`
   - `goal_orchestrate`
   - `task_graph_claim / complete / block ...`

5. Use checkpoints for high-risk nodes:

   - `goal.checkpoint.request`
   - `goal.checkpoint.approve / reject / escalate`

6. Generate reusable assets after node / goal completion:

   - `goal.retrospect.generate`
   - `goal.method_candidates.generate`
   - `goal.skill_candidates.generate`
   - `goal.flow_patterns.generate`

7. Enter the governance loop:

   - `goal.suggestion_review.list`
   - `goal.suggestion_review.workflow.set`
   - `goal.suggestion_review.decide`
   - `goal.suggestion.publish`

8. View unified approval governance summary / panel:

   - `goal.review_governance.summary`
   - `goal.approval.scan`

9. If you want automatic overdue approval scanning, create a cron job:

   - enable `BELLDANDY_CRON_ENABLED=true`
   - add a `goalApprovalScan` job via the `cron` tool

10. You do not need to manually create these runtime files; they are auto-generated:

   - `.star_sanctuary\cron-jobs.json` under your user home directory
   - `<goal.runtimeRoot>/suggestion-reviews.json`
   - `<goal.runtimeRoot>/publish-records.json`
   - `<goal.runtimeRoot>/review-notifications.json`
   - `<goal.runtimeRoot>/review-notification-dispatches.json`

> Note: `im_dm / webhook` entries inside `review-notification-dispatches.json` are currently runtime outbox records only. They are not sent to external systems yet.

---

## FAQ

### Startup says `Cannot find module ... dist/...`

This usually means build artifacts are missing or incomplete. Run:

```bash
corepack pnpm build
```

If it still fails, do a clean rebuild:

```bash
corepack pnpm rebuild
```

### `better-sqlite3` fails to build during install

Check the Node.js version first. **Node.js 22 LTS** is currently recommended. Native modules are more likely to fail on Node 24+.

### Port already in use

Change:

```env
BELLDANDY_PORT=28890
```

Then restart.

### The browser says pairing is required

That is expected. Copy the pairing code from the page and run:

```bash
corepack pnpm bdd pairing approve <CODE>
```

### I want LAN or public access

If this is only for your own remote access to a cloud server, prefer an SSH tunnel:

```bash
ssh -L 28889:127.0.0.1:28889 user@server
```

Keep the server bound to loopback with auth enabled:

```env
BELLDANDY_HOST=127.0.0.1
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

Only bind to all interfaces when other machines must directly reach the server port:

```env
BELLDANDY_HOST=0.0.0.0
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

Public exposure should also use firewall rules, a TLS reverse proxy, `BELLDANDY_ALLOWED_ORIGINS`, and a conservative tools policy. The project intentionally rejects the unsafe combination `0.0.0.0 + AUTH_MODE=none`.

### Webhook / Community API is not working

Check:

- whether the feature is enabled
- whether the Bearer Token is correct
- whether the current `stateDir` is the one you expect
- whether legacy project-root config is still active
- whether the Gateway has been restarted

---

## Related Docs

- [Star Sanctuary使用手册.md](./Star%20Sanctuary使用手册.md)
- [Star Sanctuary实现内容说明.md](./Star%20Sanctuary实现内容说明.md)
- [项目使用指南.md](./项目使用指南.md)
- [docs/长期任务使用指南.md](./docs/%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [docs/超长期任务系统实现方案.md](./docs/%E8%B6%85%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E7%B3%BB%E7%BB%9F%E5%AE%9E%E7%8E%B0%E6%96%B9%E6%A1%88.md)
- [Agent官网对接使用手册.md](./Agent官网对接使用手册.md)
- [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)
- [docs/webhook.md](./docs/webhook.md)
- [docs/channels-routing.md](./docs/channels-routing.md)
- [docs/channel-security配置说明.md](./docs/channel-security%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)
- [docs/agents.json配置说明.md](./docs/agents.json%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)

---

## Sponsorship

If Star Sanctuary is useful to you, you can support its continued development.

### Afdian

[![Afdian](https://img.shields.io/badge/Afdian-Support%20the%20Author-946ce6?style=for-the-badge)](https://afdian.com/a/vrboyzero777)

<https://afdian.com/a/vrboyzero777>

### WeChat / Alipay

<p align="center">
  <img src="./assets/wechat.png" alt="WeChat QR" width="200">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./assets/alipay.jpg" alt="Alipay QR" width="200">
</p>

---

## Contact

- **Email**: [fyyx4918822@gmail.com](mailto:fyyx4918822@gmail.com)
- **QQ Group**: 1080383003
- **Issue Tracker**: [GitHub Issues](https://github.com/vrboyzero/star-sanctuary/issues)

Feedback, bug reports, and suggestions are welcome.

---

## 💖 Sponsors

Thank you to all the friends who support and sponsor the Star Sanctuary project. Your help makes the project better!

### 🥇 First Special Sponsor

**Special Thanks: 王道 (Wang Dao)**
You are the **first sponsor** in the history of this project! This trust and support from 0 to 1 is a huge milestone for us. Thank you so much!

*(More sponsor information will be displayed here in the future)*

---

## License

[MIT License](./LICENSE)

---

<p align="center">
  <em>Star Sanctuary - Your Personal AI Assistant</em>
</p>
