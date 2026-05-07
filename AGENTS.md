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
