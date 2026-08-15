import type { ToolContract } from "./tool-contract.js";
import type { ToolContractV2 } from "./tool-contract-v2.js";

type ToolContractV2Profile = Partial<Pick<
  ToolContractV2,
  | "family"
  | "riskLevel"
  | "needsPermission"
  | "isReadOnly"
  | "isConcurrencySafe"
  | "activityDescription"
  | "outputPersistencePolicy"
  | "channels"
  | "safeScopes"
  | "recommendedWhen"
  | "avoidWhen"
  | "confirmWhen"
  | "preflightChecks"
  | "fallbackStrategy"
  | "expectedOutput"
  | "sideEffectSummary"
  | "userVisibleRiskNote"
>>;

function createBrowserInteractiveProfile(input: {
  activityDescription: string;
  expectedOutput: readonly string[];
  confirmWhen: readonly string[];
  preflightChecks: readonly string[];
  sideEffectSummary: readonly string[];
  fallbackStrategy: readonly string[];
  userVisibleRiskNote: string;
  outputPersistencePolicy?: ToolContract["outputPersistencePolicy"];
}): ToolContractV2Profile {
  return {
    family: "browser",
    riskLevel: "medium",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: input.activityDescription,
    outputPersistencePolicy: input.outputPersistencePolicy ?? "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["bridge-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need browser state, DOM context, or authenticated page interaction that plain HTTP fetch cannot provide",
      "Need to drive a concrete UI step inside the active browser session instead of manipulating workspace files",
    ],
    avoidWhen: [
      "The same result can be obtained from web_fetch, browser_get_content, or browser_snapshot without mutating page state",
      "The interaction target is still ambiguous and you have not captured enough page context to act precisely",
    ],
    confirmWhen: [...input.confirmWhen],
    preflightChecks: [...input.preflightChecks],
    fallbackStrategy: [...input.fallbackStrategy],
    expectedOutput: [...input.expectedOutput],
    sideEffectSummary: [...input.sideEffectSummary],
    userVisibleRiskNote: input.userVisibleRiskNote,
  };
}

function createBrowserReadProfile(input: {
  activityDescription: string;
  expectedOutput: readonly string[];
  preflightChecks: readonly string[];
  fallbackStrategy: readonly string[];
  sideEffectSummary: readonly string[];
  userVisibleRiskNote: string;
  outputPersistencePolicy?: ToolContract["outputPersistencePolicy"];
}): ToolContractV2Profile {
  return {
    family: "browser",
    riskLevel: "low",
    needsPermission: true,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: input.activityDescription,
    outputPersistencePolicy: input.outputPersistencePolicy ?? "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["bridge-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need browser-rendered page content, DOM structure, or interactive element references from the active session",
      "Need to inspect what the live page shows after navigation, login, or client-side rendering",
    ],
    avoidWhen: [
      "The page content can be retrieved more cheaply with web_fetch or file_read without browser state",
      "You only need to mutate the page and have not first captured enough content or snapshot context to act safely",
    ],
    confirmWhen: [
      "The active page contains sensitive authenticated data or user-generated content that should not be copied broadly",
    ],
    preflightChecks: [...input.preflightChecks],
    fallbackStrategy: [...input.fallbackStrategy],
    expectedOutput: [...input.expectedOutput],
    sideEffectSummary: [...input.sideEffectSummary],
    userVisibleRiskNote: input.userVisibleRiskNote,
  };
}

const TOOL_CONTRACT_V2_PROFILES: Record<string, ToolContractV2Profile> = {
  run_command: {
    family: "command-exec",
    riskLevel: "critical",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Execute a governed development command; coding runs use a sandboxed argv plan when a backend is available",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["privileged"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need a short non-interactive command plan to inspect repo state, build output, or process diagnostics",
      "Need host toolchain behavior that cannot be expressed through dedicated workspace or patch tools",
    ],
    avoidWhen: [
      "The task requires an interactive terminal session, TUI program, or long-lived manual process",
      "A file, patch, or catalog tool can provide the same result more safely and with less blast radius",
    ],
    confirmWhen: [
      "The command writes files outside the obvious target path, mutates environment variables, or launches long-lived processes",
      "The requested executable, argv, cwd, environment keys, write scope, or network policy materially expand the execution scope",
    ],
    preflightChecks: [
      "State the intended cwd, executable, argv, expected side effects, and whether stdout/stderr are the only outputs you need",
      "For sandboxed coding runs use commandPlan with network none, an explicit write scope, and closed stdin",
      "Do not use shell redirection, pipes, command substitution, or a shell entrypoint; run_command already captures stdout/stderr",
    ],
    fallbackStrategy: [
      "Prefer workspace and patch tools when you only need repository state or a deterministic file edit",
      "Switch to terminal session tooling only when the workflow truly requires an interactive shell",
      "Prefer command-native limit/silent flags or dedicated file/log tools instead of piping to head/tail or redirecting output away",
    ],
    expectedOutput: [
      "Primary stdout text, with stderr or validation failures surfaced as tool error metadata when relevant",
      "Blocked executions should explain the policy reason instead of partially running the command",
    ],
    sideEffectSummary: [
      "May create or modify files inside the approved sandbox workspace and execute project code",
      "Sandboxing constrains host exposure but does not make destructive workspace changes recoverable or inherently safe",
    ],
    userVisibleRiskNote: "命令执行工具。Coding run 必须在可用 OCI 沙箱内使用结构化 argv；执行前确认 cwd、环境变量键、写入范围和回滚路径。",
  },
  command_job: {
    family: "command-exec",
    riskLevel: "critical",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Start and control a sandboxed background command job with cursor-based terminal output",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["privileged"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "A sandboxed build, test, or interactive program must continue after the start call returns",
      "The task needs explicit stdin, terminal resize, paged output, status, or cancellation controls",
    ],
    avoidWhen: [
      "A short closed-stdin command can return all required output through run_command",
      "Dedicated workspace, search, or patch tools can complete the task without executing project code",
    ],
    confirmWhen: [
      "Starting a job with workspace writes, a PTY, or a long timeout changes the expected execution scope",
      "Writing stdin may contain credentials or destructive interactive input",
    ],
    preflightChecks: [
      "For start, provide a shell-free commandPlan with network none, explicit writeScope, and stdinMode closed, pipe, or pty",
      "For write, resize, read, status, and cancel, use exactly the jobId returned by start",
      "Treat stdin as sensitive: never echo it in follow-up text or expect it to appear in audit output",
    ],
    fallbackStrategy: [
      "Use run_command for bounded non-interactive work",
      "If the OCI backend or node-pty is unavailable, report the fail-closed diagnostic instead of falling back to a host shell",
      "Use cursor reads rather than repeatedly requesting the whole terminal buffer",
    ],
    expectedOutput: [
      "A stable job ID, lifecycle status, cursor bounds, and paged terminal output without replaying prior pages",
      "Cancellation reports process-tree and sandbox-lease cleanup metadata or a fail-closed cleanup error",
    ],
    sideEffectSummary: [
      "Starts project code only inside the approved OCI sandbox and can retain a bounded in-memory terminal buffer",
      "Gateway restart marks unfinished jobs lost; stdin and terminal output are intentionally not persisted",
    ],
    userVisibleRiskNote: "后台命令 job。仅 sandbox-required coding run 可启动；stdin 不回显，PTY 仅在 node-pty 可用时启用，取消会回收整个进程树与 OCI lease。",
  },
  apply_patch: {
    family: "patch",
    riskLevel: "high",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Apply a structured patch to one or more workspace files",
    outputPersistencePolicy: "artifact",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["privileged"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need a reviewable multi-file code change with explicit add, update, move, or delete hunks",
      "Need to keep diffs minimal while preserving exact edit intent and current file context",
    ],
    avoidWhen: [
      "You have not re-read the current file content or localized the required edit yet",
      "The change is generated output or bulk formatting that should come from a formatter or build step",
    ],
    confirmWhen: [
      "The patch deletes, moves, or rewrites multiple files, especially user-authored files",
      "The patch would introduce substantial new logic into a file that already exceeds 3000 lines",
    ],
    preflightChecks: [
      "Re-read the target content and verify the patch hunk context matches the current file state",
      "If the target file already exceeds 3000 lines, move new feature logic into a new file and keep the original file to minimal wiring",
      "On complex webchat surfaces, prefer refining existing modules instead of adding non-essential new UI elements",
    ],
    fallbackStrategy: [
      "Use file_write only for brand-new generated output or when full-file replacement is genuinely clearer",
      "If the patch scope is broad, split it into smaller patches and verify after each step",
    ],
    expectedOutput: [
      "JSON text with patch summary buckets such as added, modified, and deleted files",
      "Patch parse or apply failures should be returned as explicit tool errors",
    ],
    sideEffectSummary: [
      "Can create, update, move, or delete multiple workspace files in one call",
      "A small patch is review-friendly, but a broad patch can still hide large behavioral changes",
    ],
    userVisibleRiskNote: "首选代码修改工具，但并不天然安全。涉及删除、移动、多文件改动或超大文件时要主动收紧范围。",
  },
  delegate_task: {
    family: "session-orchestration",
    riskLevel: "medium",
    needsPermission: false,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Delegate a task to a specific sub-agent profile",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need a bounded subtask with a clear owner, expected output, and non-overlapping write scope",
      "Need to offload a sidecar investigation or implementation slice while keeping the main thread moving",
    ],
    avoidWhen: [
      "The immediate next local step is blocked on this result and local execution is faster",
      "The task boundary, write scope, or success criteria are still ambiguous",
    ],
    confirmWhen: [
      "The delegated task may edit the same files as the main thread or another sub-agent",
      "The delegated instruction is broad enough that duplicated work or failure would be expensive",
    ],
    preflightChecks: [
      "Specify ownership, expected artifact, relevant paths, and what the sub-agent must not touch",
      "Check whether the delegated task is genuinely parallelizable or whether local execution is simpler",
    ],
    fallbackStrategy: [
      "Keep the work local when coordination overhead exceeds the expected latency win",
      "Defer delegation until you can state the deliverable and boundaries in one or two concrete sentences",
    ],
    expectedOutput: [
      "Status text plus optional task ID, session ID, output path, and sub-agent result",
      "Failures should still include sub-agent error context for triage",
    ],
    sideEffectSummary: [
      "Creates a subtask or sub-agent execution that may independently read, write, and call tools",
      "Can increase coordination cost and merge pressure even when the delegated work succeeds",
    ],
    userVisibleRiskNote: "委托本身风险中等，但会把复杂度转移到协作边界。下发前要写清 ownership、交付物和禁区。",
  },
  delegate_parallel: {
    family: "session-orchestration",
    riskLevel: "medium",
    needsPermission: false,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Delegate multiple tasks to sub-agents in parallel",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need several independent subtasks to run concurrently with clear ownership boundaries",
      "Need aggregate results from multiple specialized agents without serial handoff latency",
    ],
    avoidWhen: [
      "The tasks depend on each other, share the same write scope, or need tight serial coordination",
      "The delegation plan is still vague enough that parallel execution would mostly create merge noise",
    ],
    confirmWhen: [
      "Two or more delegated tasks may touch the same files, external systems, or approval-requiring tools",
      "The plan depends on waiting for one result before another task can be meaningfully interpreted",
    ],
    preflightChecks: [
      "Split the work into independent tasks with distinct outputs, paths, and ownership boundaries",
      "Define how you will integrate results and which task, if any, is allowed to block the main thread",
    ],
    fallbackStrategy: [
      "Use delegate_task for a single bounded subtask",
      "Keep the work local when parallel coordination overhead outweighs the expected speedup",
    ],
    expectedOutput: [
      "Aggregated status text summarizing succeeded and failed tasks plus per-task outputs",
      "Each child result may include task IDs, session IDs, and output paths when available",
    ],
    sideEffectSummary: [
      "Creates multiple subtasks that may execute and mutate workspace state concurrently",
      "Parallel success can still produce overlapping edits, duplicate side effects, or costly integration work",
    ],
    userVisibleRiskNote: "并行委托的主要风险不是单个任务失败，而是边界不清导致的并发写冲突和集成成本。",
  },
  subtask_supervisor: {
    family: "session-orchestration",
    riskLevel: "medium",
    needsPermission: false,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Observe, steer, or cancel one exact supervised parallel lane",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to inspect or control a delegate_parallel child under the current manager Conversation/run",
      "Need a current session-bound mutation with the existing SubTask command owner",
    ],
    avoidWhen: [
      "The task belongs to another manager run, team, or lane",
      "The desired action is resume, takeover, fan-in, merge, release, or deployment",
    ],
    confirmWhen: [
      "The lane may currently be performing a write or an external side effect that cancellation will interrupt",
      "Steering materially changes the accepted ownership or deliverable contract",
    ],
    preflightChecks: [
      "Observe the exact team, lane, task, and current session before steer or cancel",
      "Provide an idempotency key and expected revision for a retryable mutation",
    ],
    fallbackStrategy: [
      "Use observe again when a binding or revision conflict reports stale state",
      "Create a new explicit delegation only after a terminal or restart-lost lane cannot be safely controlled",
    ],
    expectedOutput: [
      "Bounded JSON with contentMode none, lane status, mode, exact binding, and timestamps",
      "No child instruction, steering text, worktree path, output, or error body",
    ],
    sideEffectSummary: [
      "observe is read-only; steer and cancel mutate the existing SubTask command owner",
      "A successful steer stops the current child session and relaunches the same task under a new session",
    ],
    userVisibleRiskNote: "该工具只能控制当前 manager run 精确拥有的并行 lane；steer/cancel 会改变活动 child，必须先核对 current session 与 revision。",
  },
  subtask_fan_in: {
    family: "session-orchestration",
    riskLevel: "high",
    needsPermission: false,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Preview or explicitly confirm exact supervised worktree fan-in",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to combine terminal isolated write lanes from the current manager run",
      "Every lane has revision-bound passed test evidence and approved read-only reviewer evidence",
    ],
    avoidWhen: [
      "Any lane is still active, stale, untested, shared-workspace, or outside the current manager/team binding",
      "The desired action includes automatic merge, release, deployment, or remote writes",
    ],
    confirmWhen: [
      "Preview returned a ready short-lived receipt and the authoritative lane/evidence bindings remain current",
      "The combined workspace mutation has been reviewed and conflicts are empty before receipt confirmation",
    ],
    preflightChecks: [
      "Provide exact task/current-session/revision bindings with passed test evidence for each lane",
      "Require approved read-only reviewer evidence and run preview before any confirm call",
    ],
    fallbackStrategy: [
      "Observe lanes and regenerate test/reviewer evidence when any binding, revision, or artifact becomes stale",
      "Resolve conflicts through a new isolated change and request another preview; never force the conflict receipt",
    ],
    expectedOutput: [
      "Bounded JSON with contentMode none, ready/conflict/completed status, receipt metadata, blockers, and optional audit artifact ID",
      "No patch body, worktree path, source repository path, child output, merge, release, or deployment result",
    ],
    sideEffectSummary: [
      "preview mutates only an internal resolution worktree and receipt state; it does not mutate the source workspace",
      "explicit confirm applies the receipt-bound result through the existing user-worktree owner and cleans the resolution worktree",
    ],
    userVisibleRiskNote: "fan-in confirm 会修改当前本地工作区。必须先 preview，且只能确认仍绑定 exact lane、passed test 与只读 reviewer evidence 的短期 receipt。",
  },
  subtask_worktree_dispose: {
    family: "session-orchestration",
    riskLevel: "high",
    needsPermission: false,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Preview or explicitly confirm exact interrupted worktree disposal",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "A write lane is authoritative interrupted/runtime_lost and its dirty worktree needs an explicit final disposition",
      "The manager still has the exact team/lane/task/session/revision binding",
    ],
    avoidWhen: [
      "The lane is active, clean, read-only, shared-workspace, or owned by another manager",
      "The intended action is fan-in, merge, release, deployment, or implicit archive cleanup",
    ],
    confirmWhen: [
      "Preview returned a short-lived receipt and the authoritative task/worktree content has not drifted",
      "The source repository must remain unchanged while only the exact managed lane is discarded",
    ],
    preflightChecks: [
      "Bind manager Conversation/run, team/lane/task/current session and expected revision exactly",
      "Run preview before confirm; regenerate the receipt after any task, worktree, session, or content drift",
    ],
    fallbackStrategy: [
      "Preserve the dirty worktree when receipt or content evidence is stale or cleanup is uncertain",
      "Use manual recovery or a new explicit delegation instead of broad task-level force cleanup",
    ],
    expectedOutput: [
      "Bounded JSON with contentMode none, ready/completed/failed/uncertain status, blockers, and receipt metadata",
      "No worktree path, repository path, branch, patch body, child output, or file content",
    ],
    sideEffectSummary: [
      "preview only records a short-lived receipt and content digest",
      "explicit confirm removes the exact managed subtask worktree/branch after rechecking authoritative binding and digest",
    ],
    userVisibleRiskNote: "dispose confirm 是不可逆的本地 dirty lane 删除。必须先 preview，并确认 exact manager/lane/session/revision 与内容摘要仍匹配；主仓不会被修改。",
  },
  file_write: {
    family: "workspace-write",
    riskLevel: "high",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Write or edit a file inside the workspace",
    outputPersistencePolicy: "artifact",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["privileged"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to create a new module or write a file artifact after the exact target path and mode are known",
      "Need append, replace, insert, or base64 write modes that apply_patch does not express cleanly",
    ],
    avoidWhen: [
      "A localized code change can be expressed as a smaller and more reviewable apply_patch diff",
      "The target path, encoding, overwrite scope, or file ownership is still ambiguous",
    ],
    confirmWhen: [
      "The write targets dotfiles, binary/base64 content, broad overwrite, or other privileged paths",
      "The write would expand a file that already exceeds 3000 lines instead of externalizing new logic",
    ],
    preflightChecks: [
      "Confirm path, mode, encoding, allowed path policy, and whether createDirs is intended",
      "If the target file already exceeds 3000 lines, place new feature logic in a new file and leave only minimal wiring behind",
      "For webchat, prefer folding non-critical changes into existing modules rather than adding new UI surfaces",
    ],
    fallbackStrategy: [
      "Prefer apply_patch for reviewable code edits and smaller diffs",
      "Read the target file or create a new sibling module before overwriting a large existing file",
    ],
    expectedOutput: [
      "JSON text including path, bytesWritten, mode, encoding, and totalSize",
      "Replace or insert modes may fail with explicit validation errors for missing files or invalid ranges",
    ],
    sideEffectSummary: [
      "Creates or mutates workspace files and may set executable bits on shell scripts",
      "Overwrite or base64 writes can destroy recoverable context if the target was user-authored",
    ],
    userVisibleRiskNote: "文件写入是高风险工具。写入前应确认路径、模式、编码、文件归属，以及是否在放大超大文件。",
  },
  file_edit: {
    family: "workspace-write",
    riskLevel: "high",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Replace one unique text occurrence in a previously read workspace file",
    outputPersistencePolicy: "artifact",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["privileged"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need one unique local replacement in a previously read UTF-8 workspace file",
      "Need stale-file protection without expressing a full unified patch",
    ],
    avoidWhen: [
      "The change spans multiple files or multiple hunks and should use apply_patch",
      "The target is generated, binary, unread, or cannot be identified by one exact unique oldText",
    ],
    confirmWhen: [
      "The replacement touches user-authored source or another privileged workspace path",
    ],
    preflightChecks: [
      "Obtain the exact current oldText and file_read revision for the same path",
      "Include enough surrounding text to make oldText unique and keep the replacement local",
    ],
    fallbackStrategy: [
      "Use apply_patch for multiple files, multiple hunks, file creation, deletion, or moves",
      "Follow repairHint and call file_read again when the revision is stale or matchCount is not one",
    ],
    expectedOutput: [
      "Success JSON text with path, replacements, bytesWritten, and totalSize",
      "Failure JSON text with a stable code, path, optional matchCount, and file_read repairHint",
    ],
    sideEffectSummary: [
      "Mutates exactly one existing UTF-8 workspace file after revision and unique-match validation",
      "Does not perform automatic retries, regex replacement, or multi-file patching",
    ],
    userVisibleRiskNote: "精确编辑仍是高风险写入。必须先读取同一文件，并在 revision 与唯一匹配均成立时执行。",
  },
  file_delete: {
    family: "workspace-write",
    riskLevel: "high",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Delete a file from the workspace",
    outputPersistencePolicy: "artifact",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["privileged"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to remove a known workspace file that is truly obsolete, generated, or explicitly replaced",
      "Need to clean up an explicit file path after migration, extraction, or file split work is complete",
    ],
    avoidWhen: [
      "The file may still be referenced, or a move, archive, or edit would preserve more context",
      "The delete target was inferred from a broad pattern rather than explicitly identified",
    ],
    confirmWhen: [
      "The file is user-authored, not obviously generated, or referenced by code you have not checked",
      "The delete affects a migration path, shared docs, or anything without a clear recovery path",
    ],
    preflightChecks: [
      "Confirm exact path, workspace scope, and whether the file is generated, temporary, or source-controlled",
      "Search references before deleting a file that might still be imported, linked, or documented",
    ],
    fallbackStrategy: [
      "Prefer apply_patch or file_write when archiving, replacing, or deprecating the file is safer than deletion",
      "If intent is uncertain, keep the file and record the debt instead of deleting on speculation",
    ],
    expectedOutput: [
      "JSON text with path and deleted status on success",
      "Missing file, permission, or policy violations should be returned as explicit errors",
    ],
    sideEffectSummary: [
      "Removes a workspace file and may break imports, docs, or scripts that still reference it",
      "Deletion is the least reversible workspace mutation unless version control or backups exist",
    ],
    userVisibleRiskNote: "删除是最难回滚的工作区变更之一。除非路径、引用和恢复路径都清楚，否则不要轻易执行。",
  },
  file_read: {
    family: "workspace-read",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Read a file from the workspace or an allowed extra workspace root",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web", "cli"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need the exact current contents of a known file before editing, reviewing, or answering from repository context",
      "Need a bounded workspace read with explicit path control instead of executing shell commands",
      "Need to continue a truncated read by passing the returned nextCursor unchanged",
    ],
    avoidWhen: [
      "You do not yet know the target path and should search or list first",
      "The request is really about editing or generating content rather than reading the current file state",
    ],
    confirmWhen: [
      "The file may contain secrets, credentials, or personal data even if the path itself is not blocked",
    ],
    preflightChecks: [
      "Treat offset and limit as byte counts, never line counts; omit limit for the default 100KB source read unless a smaller byte range is intentional",
      "Confirm the path, expected encoding, and whether offset/limit or maxBytes truncation could hide relevant context",
      "Reuse nextCursor only with the same unchanged file and encoding; otherwise restart from an explicit offset",
      "Prefer reading a focused file over dumping many large files into the context window",
    ],
    fallbackStrategy: [
      "Use list_files or search tooling first when the target file is not yet localized",
      "Use browser or network tools only when the source of truth is not in the workspace",
    ],
    expectedOutput: [
      "JSON text including path, size, bytesRead, actual byte range, truncation flag, encoding, revision, content, and nextCursor when more bytes remain",
      "Missing file, denied path, sensitive path, symlink target, stale cursor, or invalid range should return explicit read errors",
    ],
    sideEffectSummary: [
      "Does not mutate the workspace, but may expose sensitive or high-volume content into the model context",
      "Large reads can still create context pollution if the path or size bounds are not chosen carefully",
    ],
    userVisibleRiskNote: "只读工具，但仍要控制路径和体量，避免把无关大文件或潜在敏感内容拉进上下文。",
  },
  list_files: {
    family: "workspace-read",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "List files from the workspace or an allowed extra workspace root",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to discover project structure, candidate files, or directory boundaries before reading or editing",
      "Need a bounded directory inventory without executing shell commands",
    ],
    avoidWhen: [
      "You already know the exact file path and should read it directly",
      "Recursive listing would produce a large noisy tree when a narrower path or depth would suffice",
    ],
    confirmWhen: [
      "The requested path is broad enough that recursive listing could dump a large unrelated tree into context",
    ],
    preflightChecks: [
      "Set the narrowest possible path and recursion depth before listing",
      "If the workspace contains generated or vendor trees, avoid broad recursive scans unless they are directly relevant",
    ],
    fallbackStrategy: [
      "Use file_read once you have the exact target file",
      "Use search tooling when you need semantic matches instead of raw directory enumeration",
    ],
    expectedOutput: [
      "JSON text with normalized path, totalEntries, recursion flags, and typed directory/file entries",
      "Denied paths or non-directory targets should return explicit errors",
    ],
    sideEffectSummary: [
      "Read-only directory enumeration, but can still flood context with irrelevant file inventories if scoped poorly",
    ],
    userVisibleRiskNote: "目录枚举本身风险低，真正的问题是范围过大造成上下文噪声和判断漂移。",
  },
  text_search: {
    family: "workspace-read",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Search bounded text matches in the workspace without invoking a shell",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web", "cli"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to localize implementation, symbols, error messages, or tests before opening an exact file",
      "Need deterministic fixed-text or regular-expression search while host command execution is unavailable",
    ],
    avoidWhen: [
      "You already know an exact path and only need its contents; prefer file_read",
      "The request needs semantic/vector retrieval rather than current workspace text matches",
    ],
    confirmWhen: [
      "Overriding .gitignore can include generated or vendor content; keep the search path and glob narrow",
    ],
    preflightChecks: [
      "Set the narrowest path and glob that can contain the target",
      "Keep maxResults and contextLines bounded so a broad match cannot flood the conversation",
      "Do not use includeIgnored to bypass denied, hidden, or sensitive path boundaries",
    ],
    fallbackStrategy: [
      "Use file_read after search returns a target path and line range",
      "Use list_files only when the project structure itself is unknown and a text query is not yet available",
    ],
    expectedOutput: [
      "JSON text with path, line, column, bounded excerpts, ignore diagnostics, and a stable nextCursor when more matches remain",
      "Invalid regex, cursor mismatch, policy-denied paths, and too-small response budgets should return explicit errors",
    ],
    sideEffectSummary: [
      "Read-only workspace search; it does not execute project code or a host shell command",
      "Search still reads matching source text into the model context, so broad patterns can increase context use",
    ],
    userVisibleRiskNote: "只读代码搜索工具。默认遵守 .gitignore 和路径策略；即使显式覆盖 ignore，也不能读取敏感、隐藏或策略禁止路径。",
  },
  file_glob: {
    family: "workspace-read",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Discover bounded workspace file paths without invoking a shell",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web", "cli"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to discover candidate source, test, or configuration files before opening a specific path",
      "Need stable include/exclude glob filtering while host command execution is unavailable",
    ],
    avoidWhen: [
      "You already know an exact file path and should use file_read directly",
      "You need text or symbol matches rather than a path inventory; prefer text_search",
    ],
    confirmWhen: [
      "Overriding .gitignore can include generated or vendor paths; keep the search path and include patterns narrow",
    ],
    preflightChecks: [
      "Set the narrowest path, include, and exclude patterns that can contain the target",
      "Do not use includeIgnored or includeHidden to bypass sensitive or policy-denied path boundaries",
      "Keep maxResults bounded so broad file inventories do not flood the conversation",
    ],
    fallbackStrategy: [
      "Use file_read after glob returns an exact target path",
      "Use text_search when a known identifier, error message, or literal can localize the target more directly",
    ],
    expectedOutput: [
      "JSON text with stable file paths, include/exclude criteria, ignore diagnostics, and truncation metadata",
      "Policy-denied paths, invalid glob input, and too-small response budgets should return explicit errors",
    ],
    sideEffectSummary: [
      "Read-only workspace navigation; it does not execute project code or a host shell command",
      "Broad inventories can still consume context, so output remains bounded by result and response limits",
    ],
    userVisibleRiskNote: "只读文件发现工具。默认遵守 .gitignore 和路径策略；显式覆盖 ignore 或隐藏文件时，敏感与策略禁止路径仍不可见。",
  },
  web_fetch: {
    family: "network-read",
    riskLevel: "medium",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Fetch content from an external HTTP or HTTPS URL",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need a direct HTTP/HTTPS fetch for public web content or API responses without opening a browser session",
      "Need response headers, status codes, or truncated body content as structured JSON output",
    ],
    avoidWhen: [
      "The target requires authenticated browser state, client-side rendering, or page interaction",
      "The request touches unstable or untrusted network targets when local or workspace sources are sufficient",
    ],
    confirmWhen: [
      "The URL target is unfamiliar enough that domain allowlist, denylist, or SSRF constraints need re-checking",
      "A POST request would send user-provided payload to an external service",
    ],
    preflightChecks: [
      "Confirm protocol, host, HTTP method, payload intent, and whether redirects or private addresses are blocked as expected",
      "Bound the expected response size and remember that truncation may hide important tail content",
    ],
    fallbackStrategy: [
      "Use browser tools when the target requires rendered DOM or authenticated session state",
      "Use workspace or memory tools when the source of truth is already local",
    ],
    expectedOutput: [
      "JSON text including HTTP status, headers, response body, truncation flag, and byte count",
      "Timeout, SSRF guard, and domain-policy failures should surface as explicit fetch errors",
    ],
    sideEffectSummary: [
      "Does not mutate the workspace, but does send outbound network traffic and may disclose request headers or POST payloads to external services",
    ],
    userVisibleRiskNote: "网络读取工具。虽然是只读，但会产生真实外联流量，POST 请求和不熟悉域名要特别谨慎。",
  },
  conversation_list: {
    family: "memory",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "List persisted conversations available to the current workspace runtime",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to locate a past conversation before reading its history",
      "Need recent conversation ids, update times, or transcript availability in the current workspace scope",
    ],
    avoidWhen: [
      "You already know the exact conversation id and can call conversation_read directly",
      "You only need semantic recall rather than raw conversation lookup",
    ],
    confirmWhen: [
      "Listing conversations may reveal unrelated historical workstreams or private threads that are not needed for the current task",
    ],
    preflightChecks: [
      "Prefer conversation_id_prefix or agent_id filters when you already know the rough target",
      "Use exclude_heartbeat=true when you want user-facing chat sessions and do not need scheduler heartbeat runtimes",
      "Use exclude_subtasks=true or exclude_goal_sessions=true when you only want top-level chat sessions rather than subtask/goal runtime threads",
      "Keep the limit small enough that the result stays navigable",
    ],
    fallbackStrategy: [
      "Use conversation_read after you identify the target conversation",
      "Use memory_search if the user remembers content but not the conversation identity",
    ],
    expectedOutput: [
      "Text list of conversation ids with timestamps, message counts, and transcript/meta availability",
    ],
    sideEffectSummary: [
      "Read-only listing of persisted conversation metadata within the current workspace runtime",
    ],
    userVisibleRiskNote: "会列出当前工作区内可见的历史会话元数据。虽然只读，但仍可能暴露不相关的线程存在性。",
  },
  conversation_read: {
    family: "memory",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Read persisted conversation history from the current workspace runtime",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need exact historical dialogue, restore state, transcript metadata, or timeline events for a known conversation",
      "Need a source of truth stronger than memory_search summaries or durable memory extraction",
    ],
    avoidWhen: [
      "You only need semantic recall or broad memory lookup and do not know the target conversation yet",
      "The required source is a workspace file, task summary, or memory note rather than a conversation transcript",
    ],
    confirmWhen: [
      "Reading a conversation may pull a large amount of unrelated or sensitive historical context into the current task",
    ],
    preflightChecks: [
      "Use conversation_list first if the exact conversation id is not certain",
      "Choose the narrowest view that answers the question: meta before restore, timeline before full transcript export",
    ],
    fallbackStrategy: [
      "Use memory_search when the user only remembers fragments and you need to localize the right thread",
      "Use task_recent or sessions_history when the need is task status rather than dialogue history",
    ],
    expectedOutput: [
      "Formatted text for one of the supported views: meta, restore, timeline, or transcript",
      "Missing-view or missing-runtime cases should surface as explicit capability errors",
    ],
    sideEffectSummary: [
      "Read-only access to persisted conversation history and transcript-derived projections",
    ],
    userVisibleRiskNote: "这是原始会话读取工具，不是抽象记忆。读取前应先确认目标 conversation 和所需视图，避免把无关历史整段拉进来。",
  },
  retrieve_tool_result: {
    family: "memory",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Retrieve recent persisted tool results so compressed outputs remain inspectable",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "A prior tool output was compressed, truncated in transcript history, or no longer visible in the active context window",
      "Need to recover the exact recent result or failure details of file_read, run_command, web_fetch, list_files, or similar tools",
    ],
    avoidWhen: [
      "You still have the required tool output in the current context and do not need persisted recovery",
      "You need full conversation chronology rather than a specific tool result artifact",
    ],
    confirmWhen: [
      "Recovering tool results may surface previously read file contents, command output, or fetched remote content that is not necessary for the current step",
    ],
    preflightChecks: [
      "Prefer tool_call_id when known; otherwise narrow with tool_name, query, or success filters",
      "Use summary/head/tail before full unless you explicitly need the whole stored output",
    ],
    fallbackStrategy: [
      "Use conversation_read when you need broader historical dialogue around the tool call",
      "Re-run the tool only when the original output is stale or the persisted recovery no longer contains the required detail",
    ],
    expectedOutput: [
      "Recent tool result records including tool name, call id, summary, and recoverable output or error content",
      "Empty matches should return a readable no-results response instead of a generic failure",
    ],
    sideEffectSummary: [
      "Read-only access to recent persisted tool result artifacts stored alongside conversation metadata",
    ],
    userVisibleRiskNote: "这是压缩后工具结果的恢复入口。优先按 tool_call_id 或明确过滤读取，避免把无关的大段旧输出重新拉回当前上下文。",
  },
  plan_current_get: {
    family: "other",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Read the current conversation plan state for the active task",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to inspect the current conversation-scoped plan before continuing a complex multi-step task",
      "Need the latest revision, focus step, next action, or terminal snapshot that the main agent is already maintaining",
    ],
    avoidWhen: [
      "The task is ordinary chat, one-shot Q&A, or another case where having no plan is normal",
      "You actually need the source-of-truth state of a goal, workflow, or subtask runtime rather than the conversation plan overlay",
    ],
    confirmWhen: [],
    preflightChecks: [
      "Treat hasPlan=false as a normal state for ordinary conversations instead of a runtime failure",
      "If you need bottom-layer truth for goal, workflow, or subtask execution, read those systems directly instead of inferring from planState alone",
    ],
    fallbackStrategy: [
      "Use goal, workflow, or subtask runtime reads directly when the plan overlay is absent or too high-level for the needed evidence",
    ],
    expectedOutput: [
      "JSON snapshot with hasPlan plus the latest current plan state when one exists",
    ],
    sideEffectSummary: [
      "Read-only access to the conversation-scoped current plan overlay",
    ],
    userVisibleRiskNote: "这是低风险只读工具。普通会话没有 current plan 属于正常情况，不应因此反推系统异常。",
  },
  plan_current_update: {
    family: "other",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Create or patch the current conversation plan state for complex multi-step work",
    outputPersistencePolicy: "external-state",
    channels: ["gateway", "web", "cli"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to lazily create or maintain a single current plan for a complex multi-step task that will span multiple turns, modules, or blockers",
      "Need to update step status, focus, next action, blocker, or read-only refs while keeping one conversation-scoped plan truth",
    ],
    avoidWhen: [
      "The task is ordinary chat, a one-shot explanation, a tiny single-step fix, or another case where no persistent plan is warranted",
      "You are trying to make planState the source of truth for goal, workflow, or subtask runtimes instead of using refs as a read-only bridge",
    ],
    confirmWhen: [
      "You are replacing an existing current plan; end the old current plan intentionally and provide a distinct replacement plan instead of silently overwriting it",
    ],
    preflightChecks: [
      "Use ifAbsent=create only after the task has clearly entered a complex multi-step execution phase; otherwise leave ordinary conversations without a plan",
      "When a plan reaches completed or cancelled, keep the terminal snapshot unless the user explicitly wants it cleared or you are intentionally replacing it with a new current plan",
      "Treat goal, workflow, and subtask refs as read-only bridge metadata and jump targets rather than objects that plan_current_update should govern bidirectionally",
    ],
    fallbackStrategy: [
      "Use plan_current_get first when you need the latest revision before patching an existing plan",
      "Use replace for a truly new current plan and incremental patch operations for ordinary progress updates; do not silently overwrite a finished plan",
    ],
    expectedOutput: [
      "JSON result with applied/conflict state plus the latest current plan snapshot after the patch",
    ],
    sideEffectSummary: [
      "Mutates the conversation-scoped current plan state and can replace or clear the visible current plan for this conversation",
      "Successful updates also emit conversation.plan.updated so WebChat can refresh the plan panel",
    ],
    userVisibleRiskNote: "这是低风险会话状态工具，但它会改变当前会话计划面板的真源。普通会话默认不需要它；替换旧计划时要显式进入新的 current plan。",
  },
  memory_search: {
    family: "memory",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Search indexed runtime memory and conversation history",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need semantic or keyword lookup across indexed memory, session history, MEMORY.md, or memory files",
      "Need a compact recall step before deciding whether to open a specific memory file or workspace source",
    ],
    avoidWhen: [
      "You already know the exact memory file path and should use memory_read directly",
      "The source of truth is a current workspace file rather than indexed memory content",
    ],
    confirmWhen: [
      "The query is broad enough that recalled content may pull unrelated historical or personal context into the conversation",
    ],
    preflightChecks: [
      "Set detail_level intentionally so summary mode does not hide needed evidence and full mode does not explode context size",
      "Use filters such as memory_type, channel, topic, or date range when the memory corpus is broad",
    ],
    fallbackStrategy: [
      "Use memory_read once search has localized the relevant memory file or source path",
      "Use file_read when the needed content lives in the workspace rather than the indexed memory surface",
    ],
    expectedOutput: [
      "Formatted text results with source path, score, and either summary or full content snippets",
      "No-match cases should return an explicit no-results message instead of empty text",
    ],
    sideEffectSummary: [
      "Read-only retrieval from indexed memory, but recalled content can expand model context with historical facts or prior conversations",
      "Search also links retrieved memories to current task usage, affecting observability rather than mutating memory content",
    ],
    userVisibleRiskNote: "记忆检索本身只读，但广义查询容易把不相关的历史内容拉进当前上下文，过滤条件要尽量具体。",
  },
  memory_read: {
    family: "memory",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Read a structured memory file from the workspace memory area",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need the exact contents of MEMORY.md or a specific daily memory file after you already know the target path",
      "Need line-bounded reading of a memory file for verification or follow-up summarization",
    ],
    avoidWhen: [
      "You do not yet know which memory file is relevant and should search first",
      "The needed source is a normal workspace file rather than the memory area",
    ],
    confirmWhen: [
      "The target memory file may contain sensitive personal context, shared memory, or prior task details that are not all relevant now",
    ],
    preflightChecks: [
      "Confirm the memory file path and whether line-bounded reading is enough instead of dumping the whole file",
      "Prefer the narrowest read slice that still preserves the evidence you need",
    ],
    fallbackStrategy: [
      "Use memory_search to localize candidate files before reading one directly",
      "Use file_read when the path is outside the structured memory area",
    ],
    expectedOutput: [
      "Text output that includes normalized path, total line count, and the selected memory file content",
    ],
    sideEffectSummary: [
      "Does not mutate memory files, but may expose historical notes or personal data into current context",
      "Successful reads also mark the source memory as used for task-level observability",
    ],
    userVisibleRiskNote: "记忆文件读取是只读操作，但仍可能把高敏感历史上下文拉进当前任务，需要控制路径和范围。",
  },
  memory_get: {
    family: "memory",
    riskLevel: "low",
    needsPermission: false,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "Return a deprecated memory retrieval notice",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe", "web-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Only for legacy flows that still call memory_get and need explicit migration guidance",
    ],
    avoidWhen: [
      "Any real memory read or search request. Prefer memory_read, memory_search, or file_read instead",
    ],
    confirmWhen: [],
    preflightChecks: [
      "If you intended to read memory content, switch to memory_read or memory_search before executing",
    ],
    fallbackStrategy: [
      "Use memory_search to find relevant memory content",
      "Use memory_read or file_read to open a known target file directly",
    ],
    expectedOutput: [
      "Deprecated guidance text that tells the caller which replacement tool to use",
    ],
    sideEffectSummary: [
      "No state mutation and no memory content read; this tool only returns migration guidance",
    ],
    userVisibleRiskNote: "兼容性工具。它不会返回真实记忆内容，只会提示迁移到新工具。",
  },
  browser_open: createBrowserInteractiveProfile({
    activityDescription: "Open a new browser tab at the specified URL",
    expectedOutput: [
      "Browser status text confirming that a new tab was opened and bound to the requested URL",
    ],
    confirmWhen: [
      "Opening the target URL may switch context to a sensitive authenticated site or user session",
    ],
    preflightChecks: [
      "Validate the target URL and confirm that a new tab is preferable to reusing the current page",
      "Check whether the task really needs live browser state or can use web_fetch instead",
    ],
    fallbackStrategy: [
      "Use web_fetch for static HTTP reads when a live browser session is unnecessary",
      "Use browser_navigate when you intentionally want to reuse the current active tab",
    ],
    sideEffectSummary: [
      "Creates a new live browser tab and changes the active browsing surface for subsequent browser tools",
    ],
    userVisibleRiskNote: "打开新标签页会改变后续浏览器工具的工作上下文，尤其要注意账号态页面和敏感站点。",
  }),
  browser_navigate: createBrowserInteractiveProfile({
    activityDescription: "Navigate the active browser page to a URL",
    expectedOutput: [
      "Browser status text confirming navigation of the active page",
    ],
    confirmWhen: [
      "Navigation would discard the current page context before you have captured needed content or snapshot state",
    ],
    preflightChecks: [
      "Confirm the active tab is the one you intend to reuse before navigating",
      "Capture content or snapshot state first if the current page may be hard to recover",
    ],
    fallbackStrategy: [
      "Use browser_open if you need to preserve the current page and browse in a new tab",
      "Use web_fetch if you only need the target page content without browser state",
    ],
    sideEffectSummary: [
      "Replaces the active page and can discard current DOM context, form state, or navigation history relevance",
    ],
    userVisibleRiskNote: "复用当前标签导航前，先确认不会丢失你后面还要依赖的页面上下文。",
  }),
  browser_click: createBrowserInteractiveProfile({
    activityDescription: "Click an element on the active browser page",
    expectedOutput: [
      "Browser status text naming the selector or snapshot-derived target that was clicked",
    ],
    confirmWhen: [
      "The click may submit a form, trigger irreversible UI actions, or navigate away from the current page",
    ],
    preflightChecks: [
      "Use browser_snapshot or page content to verify the target element before clicking",
      "Check whether the click has side effects such as submit, purchase, delete, or modal dismissal behavior",
    ],
    fallbackStrategy: [
      "Use browser_snapshot or browser_get_content first when the target element is not fully identified",
      "Prefer non-mutating read tools when the task only requires inspection",
    ],
    sideEffectSummary: [
      "May trigger navigation, submissions, state changes, or other irreversible actions in the live browser session",
    ],
    userVisibleRiskNote: "浏览器点击是典型高不确定性交互。未确认目标和副作用前，不要直接点。",
  }),
  browser_type: createBrowserInteractiveProfile({
    activityDescription: "Type text into an element on the active browser page",
    expectedOutput: [
      "Browser status text describing where the text was typed",
    ],
    confirmWhen: [
      "Typing may overwrite existing input, submit secrets, or trigger live validation or autosave behavior",
    ],
    preflightChecks: [
      "Verify the target field and current page state before typing",
      "Check whether the text contains secrets or user-specific data that should not be sent to the page",
    ],
    fallbackStrategy: [
      "Use browser_snapshot first when the correct target element is still ambiguous",
      "Avoid typing if a read-only inspection is sufficient",
    ],
    sideEffectSummary: [
      "Mutates form state on the live page and may trigger autosave, validation, or downstream browser actions",
    ],
    userVisibleRiskNote: "输入文本可能触发表单状态变化、自动保存或泄露敏感内容，目标元素必须先确认。",
  }),
  browser_screenshot: createBrowserInteractiveProfile({
    activityDescription: "Capture a screenshot from the active browser page",
    outputPersistencePolicy: "artifact",
    expectedOutput: [
      "JSON text containing the stored PNG path and image understanding status",
      "When automatic image understanding is enabled, a concise screenshot summary and structured understanding payload",
    ],
    confirmWhen: [
      "The page contains sensitive account, personal, or internal data that should not be persisted as an artifact",
    ],
    preflightChecks: [
      "Confirm the page is displaying the intended state before capturing the screenshot",
      "Check whether saving a local image artifact is acceptable for this task",
    ],
    fallbackStrategy: [
      "Use browser_snapshot or browser_get_content when text structure is sufficient and an image artifact is unnecessary",
    ],
    sideEffectSummary: [
      "Writes a screenshot artifact to the workspace screenshots directory and persists whatever is visible on the page",
    ],
    userVisibleRiskNote: "截图会把当前可见内容落盘成工件，涉及隐私、账号态或内部信息时要先确认。",
  }),
  browser_get_content: createBrowserReadProfile({
    activityDescription: "Read content from the active browser page",
    expectedOutput: [
      "Text output in markdown, plain text, or HTML form, truncated when content exceeds the configured limit",
    ],
    preflightChecks: [
      "Choose markdown, text, or HTML based on whether you need readability, raw content, or exact source structure",
      "Wait for the page to finish meaningful rendering before capturing content",
    ],
    fallbackStrategy: [
      "Use browser_snapshot when you need interactive element IDs and DOM affordance instead of page prose",
      "Use web_fetch when browser state and client-side rendering are unnecessary",
    ],
    sideEffectSummary: [
      "Read-only page capture, but may pull large amounts of rendered or authenticated content into the conversation context",
    ],
    userVisibleRiskNote: "页面正文抓取是只读操作，但要留意账号态页面和超长内容带来的信息泄露与上下文污染。",
  }),
  browser_snapshot: createBrowserReadProfile({
    activityDescription: "Capture an interactive DOM snapshot of the active page",
    expectedOutput: [
      "Compressed DOM snapshot text with stable numeric IDs for interactive elements",
    ],
    preflightChecks: [
      "Refresh snapshot state after navigation or major DOM changes before using element IDs for clicks or typing",
      "Use snapshot when you need action targets, not full article text",
    ],
    fallbackStrategy: [
      "Use browser_get_content when you need readable article text or raw HTML instead of interaction IDs",
      "Use browser_screenshot only when visual appearance matters more than DOM/actionability",
    ],
    sideEffectSummary: [
      "Read-only DOM capture, but stale snapshots can mislead later browser_click or browser_type actions if the page changed",
    ],
    userVisibleRiskNote: "快照本身只读，但后续若拿旧快照的元素 ID 去操作页面，风险会迅速上升。",
  }),
  screen_list_targets: {
    family: "other",
    riskLevel: "low",
    needsPermission: true,
    isReadOnly: true,
    isConcurrencySafe: true,
    activityDescription: "List local desktop display and window targets that can be used for screen capture",
    outputPersistencePolicy: "conversation",
    channels: ["gateway", "web", "cli"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to discover available displays or windows before choosing a screen capture target",
      "Need a stable displayRef or windowRef for a later screen_capture call",
    ],
    avoidWhen: [
      "You already know the exact target and can capture it directly without enumerating the whole desktop state",
      "The task only needs browser-page visuals and browser_screenshot already covers it",
    ],
    confirmWhen: [
      "The machine may be presenting sensitive window titles or application names that should not be listed broadly",
    ],
    preflightChecks: [
      "Confirm the native desktop helper is configured and available on the current host",
      "Use includeDisplays/includeWindows filters to keep the listing focused when possible",
    ],
    fallbackStrategy: [
      "If helper capabilities are unavailable, fall back to browser_screenshot for browser-only tasks",
      "If only one known window is relevant, pass title filters instead of listing every window",
    ],
    expectedOutput: [
      "JSON text containing helper status plus available displays and windows with stable refs",
    ],
    sideEffectSummary: [
      "Read-only enumeration of local desktop targets, but it can expose visible application names and window titles",
    ],
    userVisibleRiskNote: "这是本机桌面目标枚举工具。虽然只读，但会暴露当前窗口标题、应用名和显示器信息。",
  },
  screen_capture: {
    family: "other",
    riskLevel: "high",
    needsPermission: true,
    isReadOnly: false,
    isConcurrencySafe: false,
    activityDescription: "Capture a local desktop, display, window, or region screenshot and optionally auto-analyze it",
    outputPersistencePolicy: "artifact",
    channels: ["gateway", "web"] satisfies ToolContract["channels"],
    safeScopes: ["local-safe"] satisfies ToolContract["safeScopes"],
    recommendedWhen: [
      "Need to inspect the actual local desktop, a native application window, or a screen region outside the browser relay",
      "Need a screenshot artifact whose result should immediately feed into image understanding",
    ],
    avoidWhen: [
      "The target is only a browser page and browser_screenshot is sufficient with less host exposure",
      "The required answer can be obtained from DOM, file content, or structured app state without capturing the screen",
    ],
    confirmWhen: [
      "The capture may include private messages, credentials, internal dashboards, or unrelated windows on the host machine",
      "You are about to capture the full desktop when a narrower window or region target would suffice",
    ],
    preflightChecks: [
      "Confirm the native desktop helper, ffmpeg, and any target refs are available on the current host",
      "Prefer window or region capture over full desktop capture when the scope can be narrowed",
      "Check whether automatic image understanding should stay enabled for this screenshot path",
    ],
    fallbackStrategy: [
      "Use screen_list_targets first when the target window or display is not yet stable",
      "Fall back to browser_screenshot for browser content or to camera_snap for camera-origin visuals",
    ],
    expectedOutput: [
      "JSON text containing the saved screenshot artifact path, capture target metadata, and image understanding status",
      "When automatic image understanding succeeds, a concise preview and structured image understanding payload",
    ],
    sideEffectSummary: [
      "Writes a screenshot artifact to the workspace and may also trigger a follow-up image understanding model call",
      "Can persist sensitive host-screen content that was visible at capture time",
    ],
    userVisibleRiskNote: "这是本机屏幕截图工具。它会把桌面/窗口内容落盘，且可能继续触发图片识别；涉及隐私和账号态时要先收窄范围。",
  },
};

export function getToolContractV2Profile(name: string): ToolContractV2Profile | undefined {
  return TOOL_CONTRACT_V2_PROFILES[name];
}
