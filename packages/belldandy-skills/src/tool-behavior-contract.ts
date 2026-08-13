import type { ToolContract } from "./tool-contract.js";

export interface ToolBehaviorContract {
  name: string;
  useWhen: readonly string[];
  avoidWhen: readonly string[];
  preflightChecks: readonly string[];
  fallbackStrategy: readonly string[];
}

const TOOL_BEHAVIOR_CONTRACTS: ToolBehaviorContract[] = [
  {
    name: "run_command",
    useWhen: [
      "Need host-level inspection or execution that cannot be expressed with dedicated tools",
      "Need shell-native output such as build, test, git, or process diagnostics",
    ],
    avoidWhen: [
      "A dedicated file or patch tool can do the job more safely",
      "The task can be answered from existing prompt or workspace context without execution",
    ],
    preflightChecks: [
      "Confirm cwd, target scope, and whether the command is non-interactive",
      "Check whether the command changes files, processes, or external state",
      "Do not rely on shell redirection like >, <, or 2>/dev/null because run_command already captures stdout/stderr",
    ],
    fallbackStrategy: [
      "Prefer file_read, list_files, apply_patch, or tools.list when execution is unnecessary",
      "If execution is risky or broad, delegate or ask for confirmation instead of improvising",
      "Use command-native limit flags or dedicated file/log tools instead of piping to head/tail or redirecting output away",
    ],
  },
  {
    name: "apply_patch",
    useWhen: [
      "Need a precise, reviewable code or text edit inside the workspace",
      "Need to keep the diff minimal and avoid full-file rewrites",
    ],
    avoidWhen: [
      "The change is generated output or bulk formatting better handled by a formatter",
      "The target file is unknown or the required edit has not been localized yet",
    ],
    preflightChecks: [
      "Read the target file first and confirm the patch matches current content",
      "Keep the patch scoped to the requested change and avoid unrelated churn",
    ],
    fallbackStrategy: [
      "Use file_write only when creating a brand-new file or replacing generated output is clearer",
      "If the edit is too broad, split it into smaller patches before applying",
    ],
  },
  {
    name: "delegate_task",
    useWhen: [
      "A bounded subtask can run independently under a more specific agent profile",
      "Parallel delegation materially reduces latency without blocking the immediate next step",
    ],
    avoidWhen: [
      "The work is on the critical path and you need the result before the next local action",
      "The task is vague, tightly coupled, or likely to cause overlapping edits",
    ],
    preflightChecks: [
      "Define a concrete output, ownership boundary, and relevant context for the sub-agent",
      "Check whether local execution is faster than delegation for this step",
    ],
    fallbackStrategy: [
      "Keep the work local when coordination cost exceeds the value of delegation",
      "If multiple tasks overlap, narrow the ask or defer delegation until boundaries are clearer",
    ],
  },
  {
    name: "file_write",
    useWhen: [
      "Need to create or update a workspace file and apply_patch is not the clearest fit",
      "Need append, replace, insert, or binary/base64 write modes supported by the file tool",
    ],
    avoidWhen: [
      "A small localized edit can be expressed as a safer apply_patch diff",
      "The target path, write mode, or file content is still ambiguous",
    ],
    preflightChecks: [
      "Confirm path, mode, encoding, and whether createDirs or line-based edits are intended",
      "Check that the write will stay inside allowed workspace roots and not touch sensitive files",
    ],
    fallbackStrategy: [
      "Prefer apply_patch for reviewable code changes and minimal diffs",
      "If the change is risky, inspect or read the target file first before writing",
    ],
  },
  {
    name: "file_edit",
    useWhen: [
      "Need one unique local replacement in a previously read UTF-8 workspace file",
      "Need stale-file protection and a smaller interface than a multi-hunk patch",
    ],
    avoidWhen: [
      "The change spans multiple files or multiple hunks and should remain one reviewable apply_patch operation",
      "The target text has not been read, is not unique, or requires regex, line-number, or generated-output semantics",
    ],
    preflightChecks: [
      "Obtain the current path, exact oldText, and file_read revision before editing",
      "Include enough surrounding text in oldText to make the match unique without rewriting unrelated content",
    ],
    fallbackStrategy: [
      "Use apply_patch for multi-file, multi-hunk, add, delete, or move operations",
      "On stale or non-unique failure, follow repairHint, call file_read again, and retry with current unique text",
    ],
  },
  {
    name: "file_delete",
    useWhen: [
      "Need to remove a workspace file that is no longer needed and the target path is explicit",
      "The deletion is part of the requested task and can be clearly justified",
    ],
    avoidWhen: [
      "The target file may still be needed, or the delete scope is inferred rather than confirmed",
      "A rename, move, or content edit would preserve more context than deletion",
    ],
    preflightChecks: [
      "Confirm the exact path and that the file is inside the allowed workspace scope",
      "Check whether the file is generated, temporary, or user-authored and whether recovery exists",
    ],
    fallbackStrategy: [
      "Prefer editing, archiving, or asking for confirmation when deletion intent is unclear",
      "If the file may still be referenced, inspect usages before removing it",
    ],
  },
  {
    name: "delegate_parallel",
    useWhen: [
      "Multiple independent subtasks can run concurrently with clear ownership boundaries",
      "Parallel execution will reduce latency without causing overlapping edits",
    ],
    avoidWhen: [
      "The tasks depend on each other or share the same immediate write scope",
      "The delegation plan is still vague or the results need heavy serial coordination",
    ],
    preflightChecks: [
      "Split the work into independent tasks with explicit outputs and non-overlapping responsibility",
      "Check whether local execution or single-agent delegation is simpler for this step",
    ],
    fallbackStrategy: [
      "Use delegate_task for a single bounded subtask",
      "Keep work local when the parallel overhead outweighs the expected speedup",
    ],
  },
  {
    name: "subtask_fan_in",
    useWhen: [
      "Need to combine one to four terminal isolated write lanes owned by the current manager run",
      "Passed test evidence and approved read-only reviewer evidence exist for every exact lane revision",
    ],
    avoidWhen: [
      "Any lane is active, stale, untested, not worktree-isolated, or owned by another manager/team",
      "The intended action is automatic merge, release, deployment, or a reviewer workspace mutation",
    ],
    preflightChecks: [
      "Provide exact team/lane/task/current-session bindings, expected revisions, passed test evidence, and approved read-only review evidence",
      "Run preview first and inspect conflict status before explicitly confirming the returned short-lived receipt",
    ],
    fallbackStrategy: [
      "Refresh lane observation and evidence when binding, revision, session, artifact, or receipt freshness fails",
      "Resolve conflicts outside fan-in, produce new evidence, and request a new preview rather than forcing a mutation",
    ],
  },
  {
    name: "subtask_supervisor",
    useWhen: [
      "Need to observe, steer, or cancel one delegate_parallel lane owned by the current manager run",
      "Need exact task and current session binding before changing an active child",
    ],
    avoidWhen: [
      "The subtask was not created by the current manager run and team lane",
      "A task-level user action or a new independent delegation is the intended operation",
    ],
    preflightChecks: [
      "Observe the exact team, lane, task, and current session before steer or cancel",
      "Reuse an idempotency key and expected revision when retrying a mutation",
    ],
    fallbackStrategy: [
      "Use observe again when the session or revision changed before retrying",
      "Leave terminal or restart-lost lanes untouched unless an explicit new delegation is required",
    ],
  },
  {
    name: "subtask_worktree_dispose",
    useWhen: [
      "Need to explicitly dispose one interrupted dirty write lane after a crash or runtime loss",
      "The exact manager/team/lane/task/session/revision binding is still authoritative",
    ],
    avoidWhen: [
      "The lane is active, clean, read-only, shared-workspace, or owned by another manager",
      "The intended action is fan-in, merge, release, deployment, or implicit task archive cleanup",
    ],
    preflightChecks: [
      "Run preview first and confirm the short-lived receipt only after the lane remains interrupted and unchanged",
      "Keep the source repository outside the mutation target and verify the exact lane binding",
    ],
    fallbackStrategy: [
      "Regenerate preview after any session, revision, worktree, or content drift",
      "Preserve the lane for manual recovery when cleanup returns uncertain",
    ],
  },
];

export function getToolBehaviorContract(
  input: string | Pick<ToolContract, "name">,
): ToolBehaviorContract | undefined {
  const name = typeof input === "string" ? input : input.name;
  return TOOL_BEHAVIOR_CONTRACTS.find((contract) => contract.name === name);
}

export function listToolBehaviorContracts(
  input?: readonly string[] | readonly Pick<ToolContract, "name">[],
): ToolBehaviorContract[] {
  if (typeof input === "undefined") {
    return [...TOOL_BEHAVIOR_CONTRACTS];
  }

  const included = new Set(
    input.map((item) => typeof item === "string" ? item : item.name),
  );

  return TOOL_BEHAVIOR_CONTRACTS.filter((contract) => included.has(contract.name));
}

export function buildToolBehaviorContractSummary(
  contracts: readonly ToolBehaviorContract[],
): string {
  if (contracts.length === 0) {
    return "";
  }

  const lines: string[] = [
    "# Tool Behavior Contracts",
    "",
    "Apply these tool-specific rules before selecting a high-leverage tool.",
    "",
  ];

  for (const contract of contracts) {
    lines.push(`## ${contract.name}`);
    lines.push(`Use when: ${contract.useWhen.join("; ")}`);
    lines.push(`Avoid when: ${contract.avoidWhen.join("; ")}`);
    lines.push(`Preflight: ${contract.preflightChecks.join("; ")}`);
    lines.push(`Fallback: ${contract.fallbackStrategy.join("; ")}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}
