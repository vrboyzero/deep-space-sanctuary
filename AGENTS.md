# Repository Guidelines

This file supplements higher-priority system or workspace instructions with repository-specific contributor rules for `star-sanctuary`.

## Workspace Boundaries
- Work inside `E:\project\star-sanctuary` by default.
- Treat sibling directories `openclaw/` and `UI-TARS-desktop-main/` as reference-only; do not modify them as part of this repository.

## Project Structure & Key Entrypoints
`star-sanctuary` is a `pnpm` monorepo. Main modules live under `packages/`: `belldandy-core` for Gateway, auth, pairing, CLI, and doctor flows; `belldandy-agent` for the runtime and conversations; `belldandy-skills` for builtin tools; `belldandy-memory` for SQLite/FTS/vector retrieval; and `belldandy-channels` for Feishu and other channel adapters. Frontend code lives in `apps/web/public/` (plain JS/CSS WebChat) and `apps/browser-extension/`.

Important entrypoints:
- Gateway startup: `packages/belldandy-core/src/bin/gateway.ts`
- HTTP/WebSocket server: `packages/belldandy-core/src/server.ts`
- WebChat bootstrap: `apps/web/public/app.js`
- WebChat features: `apps/web/public/app/features/`

Detailed project navigation lives in [docs/project-map.md](docs/project-map.md). Keep the overview in this file short, and use the map for module lookup, entrypoints, and feature locations.

## Project Map Maintenance
- When project structure, module ownership, common entrypoints, or key feature locations change, update `docs/project-map.md` in the same change.
- Keep the map focused on source files and maintained directories; exclude generated or disposable trees such as `node_modules/`, `dist/`, `artifacts/`, `tmp/`, `.tmp*/`, and other runtime mirrors.
- Prefer documenting each area with both responsibility and the main entry file instead of listing directories without context.

## Codebase Memory MCP Usage

`codebase-memory-mcp` is a local, persistent code-graph cache configured for Codex only. Its current project name is `E-project-star-sanctuary`, and its allowed source root is `E:\project\star-sanctuary`. Treat graph results as navigation evidence, not as the source of truth. Detailed machine-specific configuration, monitoring, known issues, and rollback steps live in [docs/codebase-memory-mcp使用配置与限制说明.md](docs/codebase-memory-mcp%E4%BD%BF%E7%94%A8%E9%85%8D%E7%BD%AE%E4%B8%8E%E9%99%90%E5%88%B6%E8%AF%B4%E6%98%8E.md).

Use the MCP when the task needs structural context that would otherwise require reading many files:
- understanding an unfamiliar module, package boundary, architecture, entrypoint, route, or hotspot;
- finding inbound/outbound call chains or cross-package relationships;
- estimating change impact before a structural refactor, shared-contract change, or core-path modification;
- discovering qualified symbols before opening a focused set of source files.

Do not use the graph as a replacement for direct evidence:
- For exact strings, config values, a known file, or a small local diff, use `rg`, direct file reads, and `git diff` first.
- Confirm graph-derived claims against the current source before editing; confirm behavior with type checking/tests where appropriate.
- Dynamic imports, reflection, runtime registration, string dispatch, framework magic, and unindexed changes may produce missing or incorrect edges.
- Do not use this MCP to inspect or index sibling repositories; their workspace boundary remains reference-only.

Preferred query flow:
1. Call `index_status` with `project="E-project-star-sanctuary"` when freshness matters. If the tool is unavailable, fall back to repository-native search and state that the graph was not used.
2. Use `get_architecture` for an overview, or `get_graph_schema` before writing a non-trivial `query_graph` query.
3. Use `search_graph` to discover the exact symbol and qualified name before `trace_path` or `get_code_snippet`.
4. Use `trace_path` for relationships, `get_code_snippet` for focused context, and the read-only `query_graph` subset only when the higher-level tools cannot express the question.
5. Read the affected source and tests before reaching a conclusion or making a change.

Index refresh and safety rules:
- Keep `auto_index=false`, `auto_watch=false`, and team artifact persistence disabled. Never enable them as a side effect of a development task.
- Refresh manually only after material cross-file changes, when `index_status` is not ready, or when a known new symbol is missing. Do not re-index after every small edit.
- For a manual refresh, use `repo_path="E:\project\star-sanctuary"`, an explicit mode, and `persistence=false`. Run only one index operation at a time.
- After indexing, require `nodes == expected_nodes` and `edges == expected_edges`, verify one newly changed symbol, and confirm the cache WAL is no longer growing.
- Stop using the MCP if its WAL keeps growing for 10 minutes after indexing, approaches `1 GB`, results become stale, or orphan processes accumulate. Do not repeatedly retry on the same evidence.
- Never run CBM `install`, `update`, or `uninstall`, change its Codex MCP entry, move its binary/cache, or delete/rebuild its database without explicit user approval.
- Never commit `.codebase-memory/` artifacts unless the user explicitly changes the current local-only policy.

## Build, Test, and Development Commands
- `corepack pnpm install`: install workspace dependencies.
- `corepack pnpm build`: generate version metadata, build all packages, and verify workspace output.
- `corepack pnpm start`: start the built Gateway.
- `corepack pnpm dev:gateway`: run the Gateway in development mode with `tsx`.
- `corepack pnpm test`: run the full Vitest suite.
- `corepack pnpm bdd --help`: inspect CLI commands.
- `corepack pnpm bdd doctor`: run health diagnostics.
- `node .\node_modules\vitest\vitest.mjs run packages/belldandy-core/src/server.test.ts --reporter verbose`: preferred targeted Vitest pattern on Windows.

## Coding Style & Naming Conventions
Follow the surrounding file style exactly. Current code uses ESM, semicolons, double quotes, colocated `*.test.ts` / `*.test.js` files, `camelCase` for functions/variables, and `PascalCase` for types/classes. No root formatter command is enforced, so keep diffs minimal and avoid unrelated reformatting.

When a file is already over `3000` lines, prefer placing new logic in a new file and keep the original file limited to wiring, registration, or forwarding. For WebChat changes, avoid UI sprawl: reuse existing panels, dialogs, `doctor`, subtask details, or settings views instead of adding new top-level navigation or sibling panels.

## Runtime & Configuration Notes
Persist local machine settings in `.env.local`, not `.env`. Do not commit secrets, pairing data, or runtime state from `~/.star_sanctuary/`, including allowlists, models, logs, sessions, plugins, or skills.

WebChat security-sensitive settings are pairing-protected by default. If multiple settings suddenly show “read failed,” verify whether the current session has completed pairing before treating it as a UI regression. Also confirm auth combinations before enabling external APIs or public bind addresses; `BELLDANDY_AUTH_MODE=none` is not compatible with every outbound capability.

## Planning Requirements
When a task needs an implementation plan, architecture note, rollout plan, or phased proposal, do not stop at a step list. The written plan must explicitly cover:
- risk level and the main failure modes,
- feasibility and key prerequisites or dependencies,
- rough workload / implementation size,
- closure boundary: what is included, what is explicitly excluded, and what counts as done,
- intended effect: why each planned item exists and what outcome it should produce.

The goal is to prevent plans from expanding without control. If any item is intentionally deferred, say so directly.

For implementation-plan / proposal / rollout / phased design documents, add a final section named `实施计划进度表` at the end of the document and treat it as the document's only progress-tracking source. Do not scatter progress updates, stage status, or completion notes across multiple sections of the same document; update the final progress table instead.

当你回写项目文档中的开发进度、阶段状态或本轮完成情况时，如果当前阶段还没有结束，必须同步补一段“后续计划”，并说明：
- 下一步准备做什么，
- 为什么先做它，
- 当前还缺的关键闭环是什么。

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

## Testing & Validation Guidelines
Vitest is the primary test runner. Add or update tests for logic changes, especially in `packages/*/src` and `apps/web/public/app/features/`. For small frontend, settings, or doctor changes, prefer this order: pure function tests, then targeted module validation, then minimal browser verification.

For WebChat changes, confirm:
- the page loads normally,
- no new console errors appear,
- the relevant DOM wiring still works.

Windows-specific guidance:
- If targeted Vitest appears stuck before execution, first suspect heavy file discovery under temp directories; `vitest.config.ts` intentionally excludes `tmp/**`, `.tmp/**`, `.tmp-codex/**`, and `.playwright-mcp/**`.
- If a test fails with `spawn EPERM`, treat that as an environment or permission issue first. If permissions are fixed and the result changes to a timeout or business error, record that as a separate problem.
- If the standard test chain is unstable, do not claim success; record the exact command, the real blocker, and any substitute validation performed.
- Keep the detailed Windows note aligned with [docs/Windows Vitest 定向测试说明.md](docs/Windows%20Vitest%20%E5%AE%9A%E5%90%91%E6%B5%8B%E8%AF%95%E8%AF%B4%E6%98%8E.md).

## Commit & Pull Request Guidelines
Recent history mixes free-form messages with Conventional Commit style, but prefer `fix(scope): subject`, `feat(scope): subject`, `docs: subject`, or similar focused commits. Keep each commit scoped to one concern.

PRs should include:
- a short problem/solution summary,
- affected modules or paths,
- validation commands that actually ran,
- linked issues if applicable,
- screenshots or GIFs for visible UI changes,
- risks, config changes, and rollback notes for auth, channels, or external integrations.
