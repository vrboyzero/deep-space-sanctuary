# Star Sanctuary for VS Code

This extension is the VS Code adapter for Star Sanctuary coding-run controls. It starts the local `bdd coding-run stdio` bridge without a shell and keeps Gateway pairing, source binding, and write authorization in the Gateway.

The Explorer view shows bridge state, subscription state, terminal state, and event count. **Ask Star Sanctuary** sends a prompt through the existing Gateway `message.send` path, fixes the active local workspace as the run `cwd`, defaults tool approval to `confirm`, then automatically subscribes using the returned exact Conversation binding. Model streaming text is written only to the separate, fixed-size `Star Sanctuary Coding Stream` OutputChannel; tool arguments and tool outputs are never shown in the editor UI. **View Workspace Changes** opens VS Code's native Source Control view and does not maintain a second diff or revision state. Exact-bound Conversation and Workflow cancellation, manual Conversation subscription, and Allow Pending Tool / Deny Pending Tool remain available. Each decision preserves the exact `agentRunId + toolCallId` binding and optional `worktreeId`. The extension does not implement ACP.

## Configuration

- `starSanctuary.codingRun.command`: local `bdd` executable or absolute executable path. This is a machine-scoped VS Code setting and is spawned without a shell.
- `starSanctuary.codingRun.stateDir`: optional absolute Star Sanctuary state directory.

Missing or invalid `codingRun.command` falls back to `bdd`. Missing, relative, or invalid `codingRun.stateDir` is ignored so the bridge uses its default state directory.

The extension deliberately does not accept an environment variable for the executable path. Executable selection is local editor process policy and must not be overridden by a workspace or environment injection.

The coding prompt, workspace cwd, and stream size are intentionally not environment-configurable. The bridge only accepts a fixed, bounded request shape, requires a local absolute workspace path, and fixes `permissionMode` to `confirm`; allowing environment overrides here would weaken the editor's safe default boundary.
