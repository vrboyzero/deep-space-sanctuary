import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteGoalJson } from "./atomic-write.js";
import type {
  GoalCheckpointPolicyMode,
  GoalCapabilityRiskLevel,
  GoalReviewDeliveryChannel,
  GoalReviewGovernanceConfig,
  GoalReviewNotification,
  GoalReviewNotificationState,
  GoalReviewNotificationDispatchState,
  GoalReviewTemplate,
  GoalSuggestionReviewWorkflowEscalationMode,
  GoalSuggestionReviewWorkflowMode,
  GoalSuggestionType,
  LongTermGoal,
} from "./types.js";

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

function normalizeReviewDeliveryChannel(value: unknown): GoalReviewDeliveryChannel | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "goal_detail":
    case "goal_channel":
    case "reviewer_inbox":
    case "org_feed":
    case "im_dm":
    case "webhook":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeReviewDeliveryChannels(value: unknown): GoalReviewDeliveryChannel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeReviewDeliveryChannel(item))
    .filter((item): item is GoalReviewDeliveryChannel => Boolean(item));
  return items.length > 0 ? [...new Set(items)] : undefined;
}

function normalizeNotificationRoutes(value: unknown): Partial<Record<GoalReviewDeliveryChannel, string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const routes: Partial<Record<GoalReviewDeliveryChannel, string>> = {};
  for (const channel of ["goal_detail", "goal_channel", "reviewer_inbox", "org_feed", "im_dm", "webhook"] as const) {
    const route = normalizeString(source[channel]);
    if (route) {
      routes[channel] = route;
    }
  }
  return Object.keys(routes).length > 0 ? routes : undefined;
}

function normalizeReviewWorkflowMode(value: unknown): GoalSuggestionReviewWorkflowMode {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "chain":
    case "quorum":
      return normalized;
    default:
      return "single";
  }
}

function normalizeEscalationMode(value: unknown): GoalSuggestionReviewWorkflowEscalationMode {
  return normalizeString(value) === "manual" ? "manual" : "none";
}

function normalizeRiskLevels(value: unknown): GoalCapabilityRiskLevel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeString(item))
    .filter((item): item is GoalCapabilityRiskLevel => item === "low" || item === "medium" || item === "high");
  return items.length > 0 ? items : undefined;
}

function normalizeApprovalModes(value: unknown): GoalCheckpointPolicyMode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeString(item))
    .filter((item): item is GoalCheckpointPolicyMode => item === "none" || item === "single" || item === "strict");
  return items.length > 0 ? items : undefined;
}

function normalizeSuggestionTypes(value: unknown): GoalSuggestionType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeString(item))
    .filter((item): item is GoalSuggestionType => item === "method_candidate" || item === "skill_candidate" || item === "flow_pattern");
  return items.length > 0 ? items : undefined;
}

function normalizeReminderMinutes(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0)
    .map((item) => Math.floor(item));
  return items.length > 0 ? [...new Set(items)].sort((left, right) => right - left) : undefined;
}

function normalizeTemplate(value: unknown, index: number): GoalReviewTemplate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = normalizeString(source.id);
  const title = normalizeString(source.title);
  const target = normalizeString(source.target);
  if (!id || !title || (target !== "suggestion_review" && target !== "checkpoint" && target !== "all")) {
    return null;
  }
  const stages = Array.isArray(source.stages) ? source.stages.filter((item) => Boolean(item)) as GoalReviewTemplate["stages"] : undefined;
  return {
    id: id || `template_${index + 1}`,
    title,
    target,
    enabled: source.enabled !== false,
    mode: normalizeReviewWorkflowMode(source.mode),
    reviewers: normalizeStringList(source.reviewers),
    reviewerRoles: normalizeStringList(source.reviewerRoles),
    minApprovals: typeof source.minApprovals === "number" && Number.isFinite(source.minApprovals) ? source.minApprovals : undefined,
    stages,
    slaHours: typeof source.slaHours === "number" && Number.isFinite(source.slaHours) && source.slaHours > 0 ? source.slaHours : undefined,
    reminderMinutes: normalizeReminderMinutes(source.reminderMinutes),
    escalationMode: normalizeEscalationMode(source.escalationMode),
    escalationReviewer: normalizeString(source.escalationReviewer),
    suggestionTypes: normalizeSuggestionTypes(source.suggestionTypes),
    riskLevels: normalizeRiskLevels(source.riskLevels),
    approvalModes: normalizeApprovalModes(source.approvalModes),
  };
}

function normalizeReviewNotification(value: unknown, index: number, goalId?: string): GoalReviewNotification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const targetType = normalizeString(source.targetType);
  const kind = normalizeString(source.kind);
  const targetId = normalizeString(source.targetId);
  const message = normalizeString(source.message);
  const dedupeKey = normalizeString(source.dedupeKey);
  const createdAt = normalizeString(source.createdAt);
  if (
    (targetType !== "suggestion_review" && targetType !== "checkpoint")
    || (kind !== "sla_reminder" && kind !== "sla_overdue" && kind !== "auto_escalated")
    || !targetId
    || !message
    || !dedupeKey
    || !createdAt
  ) {
    return null;
  }
  return {
    id: normalizeString(source.id) ?? `notification_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    targetType,
    targetId,
    nodeId: normalizeString(source.nodeId),
    stageId: normalizeString(source.stageId),
    recipient: normalizeString(source.recipient),
    kind,
    message,
    dedupeKey,
    createdAt,
  };
}

export function getReviewGovernanceConfigPath(stateDir: string): string {
  return path.join(stateDir, "governance", "review-governance.json");
}

export function getDefaultReviewGovernanceConfig(now = new Date().toISOString()): GoalReviewGovernanceConfig {
  return {
    version: 1,
    reviewers: [],
    templates: [],
    defaults: {
      reminderMinutes: [60, 15],
      notificationChannels: ["goal_detail", "reviewer_inbox"],
    },
    updatedAt: now,
  };
}

export async function readReviewGovernanceConfig(stateDir: string): Promise<GoalReviewGovernanceConfig> {
  const configPath = getReviewGovernanceConfigPath(stateDir);
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const reviewers = Array.isArray(parsed.reviewers)
      ? parsed.reviewers
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const source = item as Record<string, unknown>;
          const id = normalizeString(source.id);
          const name = normalizeString(source.name);
          if (!id || !name) return null;
          return {
            id,
            name,
            reviewerRole: normalizeString(source.reviewerRole),
            channels: normalizeReviewDeliveryChannels(source.channels),
            tags: normalizeStringList(source.tags),
            active: source.active !== false,
          } as GoalReviewGovernanceConfig["reviewers"][number];
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
      : [];
    const templates = Array.isArray(parsed.templates)
      ? parsed.templates.map((item, index) => normalizeTemplate(item, index)).filter((item): item is GoalReviewTemplate => Boolean(item))
      : [];
    const defaultsSource = parsed.defaults && typeof parsed.defaults === "object" && !Array.isArray(parsed.defaults)
      ? parsed.defaults as Record<string, unknown>
      : {};
    return {
      version: 1,
      reviewers,
      templates,
      defaults: {
        suggestionTemplateId: normalizeString(defaultsSource.suggestionTemplateId),
        checkpointTemplateByRisk: defaultsSource.checkpointTemplateByRisk && typeof defaultsSource.checkpointTemplateByRisk === "object" && !Array.isArray(defaultsSource.checkpointTemplateByRisk)
          ? defaultsSource.checkpointTemplateByRisk as GoalReviewGovernanceConfig["defaults"]["checkpointTemplateByRisk"]
          : undefined,
        checkpointTemplateByApprovalMode: defaultsSource.checkpointTemplateByApprovalMode && typeof defaultsSource.checkpointTemplateByApprovalMode === "object" && !Array.isArray(defaultsSource.checkpointTemplateByApprovalMode)
          ? defaultsSource.checkpointTemplateByApprovalMode as GoalReviewGovernanceConfig["defaults"]["checkpointTemplateByApprovalMode"]
          : undefined,
        reminderMinutes: normalizeReminderMinutes(defaultsSource.reminderMinutes),
        notificationChannels: normalizeReviewDeliveryChannels(defaultsSource.notificationChannels),
        notificationRoutes: normalizeNotificationRoutes(defaultsSource.notificationRoutes),
      },
      updatedAt: normalizeString(parsed.updatedAt) ?? new Date().toISOString(),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      const defaults = getDefaultReviewGovernanceConfig();
      await writeReviewGovernanceConfig(stateDir, defaults);
      return defaults;
    }
    throw err;
  }
}

export async function writeReviewGovernanceConfig(stateDir: string, config: GoalReviewGovernanceConfig): Promise<void> {
  await atomicWriteGoalJson(getReviewGovernanceConfigPath(stateDir), config);
}

export function getGoalReviewNotificationsPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "review-notifications.json");
}

export function getDefaultGoalReviewNotifications(): GoalReviewNotificationState {
  return {
    version: 1,
    items: [],
  };
}

export function getGoalReviewNotificationDispatchesPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "review-notification-dispatches.json");
}

export function getDefaultGoalReviewNotificationDispatches(): GoalReviewNotificationDispatchState {
  return {
    version: 1,
    items: [],
  };
}

export async function readGoalReviewNotifications(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalReviewNotificationState> {
  const filePath = getGoalReviewNotificationsPath(goal);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item, index) => normalizeReviewNotification(item, index, goal.id)).filter((item): item is GoalReviewNotification => Boolean(item))
      : [];
    return { version: 1, items };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      const defaults = getDefaultGoalReviewNotifications();
      await writeGoalReviewNotifications(goal, defaults);
      return defaults;
    }
    throw err;
  }
}

export async function writeGoalReviewNotifications(goal: Pick<LongTermGoal, "runtimeRoot">, state: GoalReviewNotificationState): Promise<void> {
  await atomicWriteGoalJson(getGoalReviewNotificationsPath(goal), state);
}
