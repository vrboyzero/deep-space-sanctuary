import fs from "node:fs/promises";
import path from "node:path";
import type { LongTermGoal } from "./types.js";

export type GoalProgressEntry = {
  at?: string;
  kind:
    | "task_node_created"
    | "task_node_updated"
    | "task_node_claimed"
    | "task_node_pending_review"
    | "task_node_validating"
    | "task_node_completed"
    | "task_node_blocked"
    | "task_node_failed"
    | "task_node_skipped"
    | "checkpoint_requested"
    | "checkpoint_replay_started"
    | "checkpoint_approved"
    | "checkpoint_rejected"
    | "checkpoint_expired"
    | "checkpoint_reopened"
    | "capability_plan_generated"
    | "node_orchestrated"
    | "handoff_generated"
    | "retrospective_generated"
    | "method_candidates_generated"
    | "skill_candidates_generated"
    | "flow_patterns_generated"
    | "experience_suggestions_generated"
    | "suggestion_review_decided"
    | "suggestion_review_workflow_configured"
    | "suggestion_review_escalated"
    | "suggestion_review_scanned"
    | "suggestion_published"
    | "goal_archived";
  title: string;
  nodeId?: string;
  status?: string;
  summary?: string;
  note?: string;
  runId?: string;
  checkpointId?: string;
};

function buildLine(label: string, value?: string): string | null {
  if (!value) return null;
  return `- ${label}: ${value}`;
}

function renderEntry(entry: GoalProgressEntry): string {
  const at = entry.at ?? new Date().toISOString();
  const lines = [
    `## ${at}`,
    `- Event: ${entry.kind}`,
    `- Title: ${entry.title}`,
    buildLine("Node", entry.nodeId),
    buildLine("Status", entry.status),
    buildLine("Run", entry.runId),
    buildLine("Checkpoint", entry.checkpointId),
    buildLine("Summary", entry.summary),
    buildLine("Note", entry.note),
    "",
  ].filter((line): line is string => Boolean(line));
  return `${lines.join("\n")}\n`;
}

export type ParsedGoalProgressEntry = {
  at: string;
  event: string;
  title: string;
  nodeId?: string;
  status?: string;
  runId?: string;
  checkpointId?: string;
  summary?: string;
  note?: string;
};

export function parseGoalProgressEntries(rawContent: string): ParsedGoalProgressEntry[] {
  if (!rawContent.trim()) return [];
  const entries: ParsedGoalProgressEntry[] = [];
  const sections = rawContent.split(/^##\s+/m).filter(Boolean);
  for (const section of sections) {
    const newlineIndex = section.indexOf("\n");
    const at = newlineIndex >= 0 ? section.slice(0, newlineIndex).trim() : section.trim();
    const body = newlineIndex >= 0 ? section.slice(newlineIndex + 1) : "";
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const data: Record<string, string> = {};
    for (const line of lines) {
      const match = /^-\s+([^:]+):\s*(.*)$/.exec(line);
      if (!match) continue;
      data[match[1].trim().toLowerCase()] = match[2].trim();
    }
    if (!at) continue;
    entries.push({
      at,
      event: data.event || "",
      title: data.title || "",
      nodeId: data.node || "",
      status: data.status || "",
      runId: data.run || "",
      checkpointId: data.checkpoint || "",
      summary: data.summary || "",
      note: data.note || "",
    });
  }
  return entries.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

export async function appendGoalProgressEntry(
  goal: Pick<LongTermGoal, "progressPath">,
  entry: GoalProgressEntry,
): Promise<void> {
  await fs.mkdir(path.dirname(goal.progressPath), { recursive: true });
  await fs.appendFile(goal.progressPath, renderEntry(entry), "utf-8");
}
