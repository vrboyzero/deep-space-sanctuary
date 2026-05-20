import type { GoalUpdateArea, GoalUpdateReason } from "./types.js";

export const GOAL_UPDATE_AREA_SEMANTICS: Record<GoalUpdateArea, string> = {
  goal: "刷新 goal 摘要、列表状态、当前 detail 骨架与恢复上下文。",
  tracking: "刷新 tasks/checkpoints 派生的节点状态、阻塞、checkpoint 追踪视图。",
  progress: "刷新 progress.md 驱动的执行时间线。",
  handoff: "刷新 handoff.md 驱动的恢复交接摘要。",
  capability: "刷新 capability-plans.json 驱动的 capability plan / actual usage / 偏差分析。",
};

export const GOAL_UPDATE_PROTOCOL: Record<GoalUpdateReason, { areas: GoalUpdateArea[]; summary: string }> = {
  goal_resumed: {
    areas: ["goal", "handoff", "tracking", "progress"],
    summary: "恢复 goal 通道或节点通道后，goal 摘要、handoff、tracking、timeline 都需要同步。",
  },
  goal_paused: {
    areas: ["goal", "handoff", "tracking", "progress"],
    summary: "暂停后 goal 摘要、handoff、tracking、timeline 都需要同步。",
  },
  goal_archived: {
    areas: ["goal", "handoff", "tracking", "progress"],
    summary: "归档后 goal 摘要、handoff、tracking、timeline 都需要同步。",
  },
  goal_deleted: {
    areas: ["goal", "handoff", "tracking", "progress", "capability"],
    summary: "删除后 goal 列表、detail 以及所有派生面板都需要清空或刷新。",
  },
  task_node_created: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "新增节点会影响 goal 摘要、tracking、timeline 与 handoff 恢复建议。",
  },
  task_node_updated: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点字段更新会影响 goal 摘要、tracking、timeline 与 handoff 恢复建议。",
  },
  task_node_claimed: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点进入执行后会影响活动节点、tracking、timeline 与 handoff。",
  },
  task_node_pending_review: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点进入待审阅后会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  task_node_validating: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点进入 validating 后会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  task_node_completed: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点完成后会影响 goal 摘要、tracking、timeline 与 handoff。",
  },
  task_node_blocked: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点阻塞会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  task_node_failed: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点失败会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  task_node_skipped: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "节点跳过会影响 goal 摘要、tracking、timeline 与 handoff。",
  },
  capability_plan_saved: {
    areas: ["capability", "progress", "handoff"],
    summary: "capability plan 保存后应刷新 capability 视图，同时同步 timeline 与 handoff。",
  },
  capability_plan_orchestrated: {
    areas: ["capability", "progress", "handoff"],
    summary: "capability 编排完成后应刷新 capability 视图，同时同步 timeline 与 handoff。",
  },
  checkpoint_requested: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "checkpoint 发起后会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  checkpoint_approved: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "checkpoint 批准后会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  checkpoint_rejected: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "checkpoint 拒绝后会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  checkpoint_expired: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "checkpoint 过期后会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  checkpoint_reopened: {
    areas: ["goal", "tracking", "progress", "handoff"],
    summary: "checkpoint 重开后会影响 goal 状态、tracking、timeline 与 handoff。",
  },
  suggestion_review_updated: {
    areas: ["goal", "progress", "capability"],
    summary: "suggestion review 更新后会影响 goal 摘要、timeline 与建议/能力相关视图。",
  },
  suggestion_review_workflow_configured: {
    areas: ["goal", "progress", "capability"],
    summary: "suggestion review workflow 配置更新后会影响 goal 摘要、timeline 与建议/能力相关视图。",
  },
  suggestion_review_escalated: {
    areas: ["goal", "progress", "capability"],
    summary: "suggestion review escalation 更新后会影响 goal 摘要、timeline 与建议/能力相关视图。",
  },
  suggestion_review_scanned: {
    areas: ["goal", "progress", "capability"],
    summary: "suggestion review SLA 扫描后会影响 goal 摘要、timeline 与建议/能力相关视图。",
  },
  suggestion_published: {
    areas: ["goal", "progress", "capability"],
    summary: "suggestion 发布后会影响 goal 摘要、timeline 与建议/能力相关视图。",
  },
};

export function getGoalUpdateAreas(reason: GoalUpdateReason): GoalUpdateArea[] {
  return [...GOAL_UPDATE_PROTOCOL[reason].areas];
}
