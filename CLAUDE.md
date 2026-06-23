# CLAUDE.md

This file provides guidance to Claude Code (the project site) when working with code in this repository.

## Project Overview

Belldandy is a **local-first personal AI assistant** — a pnpm monorepo using TypeScript (ESM). It runs on the user's device and communicates through WebChat, Feishu (Lark), and extensible chat channels.

**Workspace boundary**: Only develop in `e:\project\star-sanctuary`. The sibling `openclaw/` and `UI-TARS-desktop-main/` directories are **read-only** reference code.

## Commands

```bash
corepack pnpm install          # Install dependencies
corepack pnpm build            # Build all packages
corepack pnpm start            # Start Gateway (foreground, with auto-restart)
corepack pnpm dev:gateway      # Start Gateway (dev mode)
corepack pnpm test             # Run tests
corepack pnpm bdd --help       # CLI help
corepack pnpm bdd doctor       # Health check
corepack pnpm bdd start        # Start Gateway (foreground)
corepack pnpm bdd start -d     # Start Gateway (daemon/background mode)
corepack pnpm bdd stop         # Stop Gateway daemon
corepack pnpm bdd status       # Show Gateway daemon status
```

## Package Structure

```
packages/
├── belldandy-protocol/    # Shared types: WebSocket frames, events, auth modes
├── belldandy-agent/       # Agent runtime: BelldandyAgent, ToolEnabledAgent,
│                          #   FailoverClient, ConversationStore, hook system
├── belldandy-core/        # Gateway server, security/pairing, logger, CLI
├── belldandy-skills/      # Tool executor framework + builtin tools
├── belldandy-memory/      # SQLite + FTS5 + sqlite-vec hybrid RAG
├── belldandy-channels/    # Channel abstraction + Feishu implementation
├── belldandy-mcp/         # MCP client and tool bridge
├── belldandy-plugins/     # Plugin registry: dynamic JS/MJS loading
└── belldandy-browser/     # WebSocket-CDP relay for browser automation

apps/
├── web/public/            # WebChat frontend (vanilla JS/CSS)
└── browser-extension/     # Chrome Extension for browser automation
```

## Data Flow

1. **Client** (WebChat / Feishu) → WebSocket / channel adapter
2. **Gateway** (`belldandy-core/src/server.ts`) → auth, pairing, routing
3. **Agent** (`belldandy-agent/`) → OpenAIChatAgent or ToolEnabledAgent (ReAct loop)
4. **Tools** (`belldandy-skills/`) → execute actions
5. Gateway streams events back (`chat.delta`, `chat.final`, `tool_call`, etc.)

## Key Entry Points

| Purpose | File |
|---------|------|
| Gateway startup | `packages/belldandy-core/src/bin/gateway.ts` |
| HTTP/WS server | `packages/belldandy-core/src/server.ts` |
| Agent interface | `packages/belldandy-agent/src/index.ts` |
| Tool-enabled agent | `packages/belldandy-agent/src/tool-agent.ts` |
| Tool executor | `packages/belldandy-skills/src/executor.ts` |
| Memory store | `packages/belldandy-memory/src/store.ts` |

## Security Model

- **Pairing**: Default-deny. Unknown clients get pairing code. Allowlist in `~/.star_sanctuary/allowlist.json`
- **Bind safety**: `0.0.0.0` + `AUTH_MODE=none` → forced exit
- **Dangerous tools**: `run_command` requires `BELLDANDY_DANGEROUS_TOOLS_ENABLED=true`
- **SSRF protection**: `web_fetch` has DNS rebinding check

## Environment Variables

Core variables (see `.env.example` for full list):

| Variable | Default | Description |
|----------|---------|-------------|
| `BELLDANDY_PORT` | `28889` | Gateway port |
| `BELLDANDY_HOST` | `127.0.0.1` | Bind address |
| `BELLDANDY_AUTH_MODE` | `none` | `none` / `token` / `password` |
| `BELLDANDY_AGENT_PROVIDER` | `mock` | `mock` / `openai` |
| `BELLDANDY_OPENAI_BASE_URL` | — | OpenAI-compatible API base |
| `BELLDANDY_OPENAI_API_KEY` | — | API key |
| `BELLDANDY_OPENAI_MODEL` | — | Model name |
| `BELLDANDY_TOOLS_ENABLED` | `false` | Enable tool calling |

Use `.env.local` for persistent local config (Git-ignored).

Do not commit secrets, pairing data, or runtime state from `~/.star_sanctuary/` (allowlists, models, logs, sessions, plugins, skills).

WebChat security-sensitive settings are pairing-protected by default. If multiple settings suddenly show "read failed", verify whether the current session has completed pairing before treating it as a UI regression. Confirm auth combinations before enabling external APIs or public bind addresses; `BELLDANDY_AUTH_MODE=none` is not compatible with every outbound capability.

## User Workspace (`~/.star_sanctuary/`)

```
~/.star_sanctuary/
├── SOUL.md / IDENTITY.md / USER.md   # Personality & user profile
├── TOOLS.md / AGENTS.md              # Local environment description
├── allowlist.json / pairing.json     # Security state
├── models.json                       # Failover model profiles
├── memory.db                         # SQLite (FTS5 + vector)
├── gateway.pid                       # Daemon PID file (when running in background)
├── logs/ / sessions/ / memory/       # Runtime data (logs/gateway.log for daemon output)
└── plugins/ / skills/                # User extensions
```

## Extending Belldandy

### Adding a New Agent Provider

1. Implement `BelldandyAgent` interface (async generator yielding `AgentStreamItem`)
2. Export from `packages/belldandy-agent/src/index.ts`
3. Add env-based selection in `packages/belldandy-core/src/bin/gateway.ts`

### Adding a New Builtin Tool

1. Create tool file in `packages/belldandy-skills/src/builtin/`
2. Implement `Tool` interface from `packages/belldandy-skills/src/types.ts`
3. Export from `packages/belldandy-skills/src/index.ts`
4. Register in `gateway.ts` `toolsToRegister` array

### Adding a New Channel

1. Implement `Channel` interface from `packages/belldandy-channels/src/types.ts`
2. Export from `packages/belldandy-channels/src/index.ts`
3. Add env-based initialization in `gateway.ts`

## Tech Stack

- Node.js ≥22.12.0, pnpm 10.x (corepack)
- TypeScript with project references
- Express 5 + ws for HTTP/WebSocket
- SQLite + FTS5 + sqlite-vec for RAG
- Vitest for testing

## Testing

Vitest is the primary runner. Full suite:

```bash
corepack pnpm test
```

Targeted single-file run on Windows (preferred over `pnpm test` for iteration):

```bash
node .\node_modules\vitest\vitest.mjs run packages/belldandy-core/src/server.test.ts --reporter verbose
```

If a targeted run appears stuck before execution, suspect heavy file discovery under temp directories; `vitest.config.ts` already excludes `tmp/**`, `.tmp/**`, `.tmp-codex/**`, `.playwright-mcp/**`. A `spawn EPERM` failure is an environment/permission issue, not a code bug.

Add or update tests for logic changes, especially in `packages/*/src` and `apps/web/public/app/features/`. For small frontend, settings, or doctor changes, prefer this order: pure function tests, then targeted module validation, then minimal browser verification.

For WebChat changes, confirm:
- the page loads normally,
- no new console errors appear,
- the relevant DOM wiring still works.

## Code Style

Follow the surrounding file style exactly. Current conventions:

- ESM, semicolons, double quotes
- `camelCase` for functions/variables, `PascalCase` for types/classes
- Colocated `*.test.ts` / `*.test.js` files
- No root formatter command is enforced — keep diffs minimal and avoid unrelated reformatting

When a file is already over 3000 lines, prefer placing new logic in a new file and keep the original file limited to wiring, registration, or forwarding.

For WebChat changes, avoid UI sprawl: reuse existing panels, dialogs, `doctor`, subtask details, or settings views instead of adding new top-level navigation or sibling panels.

## Navigation

`docs/project-map.md` is the authoritative module/entrypoint/feature location map. When project structure, module ownership, or key feature locations change, update it in the same change. Keep it focused on source files and maintained docs; exclude `node_modules/`, `dist/`, `artifacts/`, `tmp/`, `.tmp*/`.

Quick lookup:

- Gateway startup or dependency wiring → `packages/belldandy-core/src/bin/gateway.ts`
- An RPC/interface behavior → `packages/belldandy-core/src/server.ts` and `server-methods/`
- Agent conversation and tool calling → `packages/belldandy-agent/src/tool-agent.ts`
- Tool permissions or tool visibility → `packages/belldandy-skills/src/executor.ts`
- Memory/task/experience storage → `packages/belldandy-memory/src/store.ts`
- Long-running task governance → `packages/belldandy-core/src/goals/manager.ts`
- A WebChat page or panel → `apps/web/public/app.js` and the referenced `features/*.js`

## Architecture Notes

These cross-cutting systems require reading multiple files to understand and are not obvious from the package structure alone.

### Agent Runtime

`ToolEnabledAgent` (`packages/belldandy-agent/src/tool-agent.ts`) is the main runtime, supporting both OpenAI and Anthropic wire protocols. It integrates:

- **Compaction**: when token estimates exceed thresholds, conversation history is compressed (`compaction.ts`, `compaction-cache-aligned.ts`, `microcompact.ts`).
- **FailoverClient**: multi-model failover with cooldown classification (`failover-client.ts`); profiles loaded from `~/.star_sanctuary/models.json`.
- **Prompt snapshot/delta**: each run captures a prompt snapshot and applies run-level deltas (role/tool/team/handoff/completion-gate) via `prompt-snapshot.ts` and `runtime-prompt-deltas.ts`.
- **Hooks**: `hook-runner.ts` + `hooks.ts` fire before/after tool calls and compaction events.

### Tool Governance

Tools pass through two layers in `belldandy-skills`:

1. `security-matrix.ts` — `ToolContract` access decisions, channel-safe scopes
2. `runtime-policy.ts` — launch permission mode, role policy, allowed tool families, max risk level

`failure-kind.ts` normalizes tool failures into a taxonomy used for follow-up prompt deltas and retry routing. `faqi.ts` manages the "FAQI 法器" whitelist that scopes which tools an Agent can see.

### Memory System

`belldandy-memory/src/store.ts` is the SQLite schema + FTS5 + sqlite-vec core. Around it:

- `manager.ts` — global MemoryManager, durable extraction, P12–P15 memory tree / source governance
- `memory-tree-lifecycle*.ts` — dirty-state tracking, failure cooldown ledger, job reports
- `dream-*.ts` — offline "dream" consolidation: input aggregation, prompt, write-back, Obsidian sync, Commons export
- `external-memory-ingest.ts` — P15 external source ingest (Obsidian Markdown)

### Long-running Work & Teams

- `belldandy-core/src/goals/manager.ts` — goal state machine and governance
- `goals/capability-acceptance-gate.ts` — structured contract gate for verifier/goal fan-in
- `belldandy-agent/src/orchestrator.ts` + `launch-spec.ts` — sub-agent orchestration and delegation contracts
- `belldandy-skills/src/delegation-protocol.ts` + `builtin/session/` — parallel lane team metadata, manager-mediated handoff, completion gate
- `belldandy-core/src/task-runtime.ts` + `bridge-subtask-runtime.ts` + `background-continuation-runtime.ts` — subtask runtime, resume/takeover, background continuation ledger
- `team-identity-governance.ts` — derives authority relations / `reportsTo` / `mayDirect` from team roster metadata

### WebChat Frontend

Vanilla JS/CSS, no framework. `apps/web/public/app.js` is the assembly entry; `app/bootstrap/` holds DOM refs and global state; `app/features/*.js` are per-domain modules (chat-ui, chat-network, settings, workspace, doctor-observability, memory-runtime, goals-runtime, subtasks-runtime, etc.). `app/i18n/` holds language dictionaries.

### RPC Layer

`server.ts` dispatches `GatewayReqFrame` methods. Domain handlers live in `server-methods/` (`models`, `goal`, `memory`, `dream`, `tools`, `workspace`, `subtask`, `system-doctor`, etc.). HTTP routes (`/health`, `/api/message`, `/api/webhook/:id`, static assets) are in `server-http-routes.ts`. The main `message.send` execution chain is in `query-runtime-message-send.ts`.

## Planning Requirements

When a task needs an implementation plan, architecture note, rollout plan, or phased proposal, do not stop at a step list. The written plan must explicitly cover:

- risk level and the main failure modes,
- feasibility and key prerequisites or dependencies,
- rough workload / implementation size,
- closure boundary: what is included, what is explicitly excluded, and what counts as done,
- intended effect: why each planned item exists and what outcome it should produce.

If any item is intentionally deferred, say so directly.

For implementation-plan / proposal / rollout / phased design documents, add a final section named `实施计划进度表` at the end of the document and treat it as the document's only progress-tracking source. Do not scatter progress updates, stage status, or completion notes across multiple sections of the same document; update the final progress table instead.

When writing back development progress, stage status, or current-round completion to project docs, if the current stage has not ended, also append a "后续计划" section explaining:
- what the next step is,
- why it comes first,
- what key closure is still missing.

### Implementation Conclusion Format

When a phase, step, or feature implementation is completed and written back to project docs, use the following structured format for the implementation conclusion:

```markdown
#### [Phase/Step 名称] 实现结论：[feature 名称]（YYYY-MM-DD）

##### 已完成内容

1. **[文件名] 扩展/修改/新建**：
   - [具体改动点 1]
   - [具体改动点 2]
   - [具体改动点 3]

2. **[另一文件名] 接入/修改**：
   - [具体改动点 1]
   - [具体改动点 2]

3. **效果**：
   - [效果描述 1]
   - [效果描述 2]
   - [效果描述 3]

##### 验证结果

- TypeScript 编译无错误
- [N] 个测试全部通过（含 [M] 个新增 [feature] 测试）
- [关键功能验证结论]
```

Rules:
- Each implementation conclusion must have a heading with phase/step name, feature name, and date.
- "已完成内容" must list concrete file-level changes with bullet points.
- "效果" must describe observable outcomes, not implementation details.
- "验证结果" must include TypeScript compilation status, test count, and key functional verification.
- Do not mix progress updates into other sections; keep them in this structured format.

## Execution Rhythm

- The current development environment has strong context compression and handoff continuity. Do not worry about context window exhaustion during normal development, and do not prematurely compress or stop work out of context-limit anxiety alone.
- For multi-phase implementation work, prefer patient step-by-step execution with explicit progress checkpoints over rushing to over-compress partially completed work.

## Commit & Pull Request Guidelines

Prefer `fix(scope): subject`, `feat(scope): subject`, `docs: subject`, or similar focused Conventional Commit style. Keep each commit scoped to one concern.

PRs should include:
- a short problem/solution summary,
- affected modules or paths,
- validation commands that actually ran,
- linked issues if applicable,
- screenshots or GIFs for visible UI changes,
- risks, config changes, and rollback notes for auth, channels, or external integrations.

