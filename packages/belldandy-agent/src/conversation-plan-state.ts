import type {
    ConversationPlanPatchOperation,
    ConversationPlanRef,
    ConversationPlanSeed,
    ConversationPlanState,
    ConversationPlanStep,
    ConversationPlanUpdateInput,
    ConversationPlanUpdateResult,
    ConversationPlanUpdatedBy,
} from "@belldandy/skills";

const MAX_PLAN_TITLE_CHARS = 120;
const MAX_PLAN_TEXT_CHARS = 500;
const MAX_PLAN_STEPS = 24;
const MAX_PLAN_REFS_PER_STEP = 8;

function createPlanId(now: number): string {
    return `plan_${now.toString(36)}`;
}

function normalizeText(value: unknown, limit: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return fallback;
}

function normalizePlanRef(ref: unknown): ConversationPlanRef | undefined {
    if (!ref || typeof ref !== "object") return undefined;
    const record = ref as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const label = normalizeText(record.label, MAX_PLAN_TITLE_CHARS);
    if (kind === "goal") {
        const goalId = normalizeText(record.goalId, MAX_PLAN_TITLE_CHARS);
        if (!goalId) return undefined;
        return {
            kind: "goal",
            goalId,
            ...(normalizeText(record.nodeId, MAX_PLAN_TITLE_CHARS) ? { nodeId: normalizeText(record.nodeId, MAX_PLAN_TITLE_CHARS) } : {}),
            ...(label ? { label } : {}),
        };
    }
    if (kind === "workflow") {
        const journalId = normalizeText(record.journalId, MAX_PLAN_TITLE_CHARS);
        if (!journalId) return undefined;
        return {
            kind: "workflow",
            journalId,
            ...(normalizeText(record.workflowName, MAX_PLAN_TITLE_CHARS) ? { workflowName: normalizeText(record.workflowName, MAX_PLAN_TITLE_CHARS) } : {}),
            ...(label ? { label } : {}),
        };
    }
    if (kind === "subtask") {
        const taskId = normalizeText(record.taskId, MAX_PLAN_TITLE_CHARS);
        if (!taskId) return undefined;
        return {
            kind: "subtask",
            taskId,
            ...(normalizeText(record.sessionId, MAX_PLAN_TITLE_CHARS) ? { sessionId: normalizeText(record.sessionId, MAX_PLAN_TITLE_CHARS) } : {}),
            ...(label ? { label } : {}),
        };
    }
    return undefined;
}

function normalizePlanRefs(value: unknown): ConversationPlanRef[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized = value
        .map((item) => normalizePlanRef(item))
        .filter((item): item is ConversationPlanRef => Boolean(item))
        .slice(0, MAX_PLAN_REFS_PER_STEP);
    return normalized.length > 0 ? normalized : undefined;
}

function normalizeStepStatus(value: unknown): ConversationPlanStep["status"] {
    const normalized = typeof value === "string" ? value.trim() : "";
    switch (normalized) {
        case "in_progress":
        case "blocked":
        case "completed":
        case "skipped":
            return normalized;
        default:
            return "pending";
    }
}

function normalizePlanStatus(value: unknown): ConversationPlanState["status"] {
    const normalized = typeof value === "string" ? value.trim() : "";
    switch (normalized) {
        case "active":
        case "blocked":
        case "completed":
        case "cancelled":
            return normalized;
        default:
            return "draft";
    }
}

function normalizePlanMode(value: unknown): ConversationPlanState["mode"] {
    return value === "manual" ? "manual" : "agent";
}

function normalizeUpdatedBy(value: unknown): ConversationPlanUpdatedBy {
    switch (value) {
        case "user":
        case "system":
            return value;
        default:
            return "agent";
    }
}

function normalizePlanStep(step: unknown, now: number): ConversationPlanStep | undefined {
    if (!step || typeof step !== "object") return undefined;
    const record = step as Record<string, unknown>;
    const id = normalizeText(record.id, MAX_PLAN_TITLE_CHARS);
    const title = normalizeText(record.title, MAX_PLAN_TITLE_CHARS);
    if (!id || !title) return undefined;
    const refs = normalizePlanRefs(record.refs);
    return {
        id,
        title,
        ...(normalizeText(record.summary, MAX_PLAN_TEXT_CHARS) ? { summary: normalizeText(record.summary, MAX_PLAN_TEXT_CHARS) } : {}),
        status: normalizeStepStatus(record.status),
        ...(normalizeText(record.blocker, MAX_PLAN_TEXT_CHARS) ? { blocker: normalizeText(record.blocker, MAX_PLAN_TEXT_CHARS) } : {}),
        ...(refs ? { refs } : {}),
        updatedAt: normalizeTimestamp(record.updatedAt, now),
    };
}

function normalizePlanSteps(value: unknown, now: number): ConversationPlanStep[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizePlanStep(item, now))
        .filter((item): item is ConversationPlanStep => Boolean(item))
        .slice(0, MAX_PLAN_STEPS);
}

function normalizePlanSeed(seed: ConversationPlanSeed | undefined): {
    title: string;
    summary?: string;
    mode: ConversationPlanState["mode"];
    status: Extract<ConversationPlanState["status"], "draft" | "active">;
} | undefined {
    if (!seed || typeof seed !== "object") return undefined;
    const title = normalizeText(seed.title, MAX_PLAN_TITLE_CHARS);
    if (!title) return undefined;
    return {
        title,
        ...(normalizeText(seed.summary, MAX_PLAN_TEXT_CHARS) ? { summary: normalizeText(seed.summary, MAX_PLAN_TEXT_CHARS) } : {}),
        mode: normalizePlanMode(seed.mode),
        status: seed.status === "active" ? "active" : "draft",
    };
}

function dedupePlanRefs(refs: ConversationPlanRef[]): ConversationPlanRef[] {
    const seen = new Set<string>();
    const output: ConversationPlanRef[] = [];
    for (const ref of refs) {
        const key = ref.kind === "goal"
            ? `goal:${ref.goalId}:${ref.nodeId ?? ""}`
            : ref.kind === "workflow"
                ? `workflow:${ref.journalId}`
                : `subtask:${ref.taskId}:${ref.sessionId ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(ref);
    }
    return output.slice(0, MAX_PLAN_REFS_PER_STEP);
}

function buildEmptyPlan(seed: ReturnType<typeof normalizePlanSeed>, now: number, updatedBy: ConversationPlanUpdatedBy): ConversationPlanState {
    return {
        version: 1,
        planId: createPlanId(now),
        revision: 0,
        status: seed?.status ?? "draft",
        title: seed?.title ?? "Untitled Plan",
        ...(seed?.summary ? { summary: seed.summary } : {}),
        mode: seed?.mode ?? "agent",
        createdAt: now,
        updatedAt: now,
        updatedBy,
        steps: [],
    };
}

export function normalizeConversationPlanState(
    value: unknown,
    fallbackNow: number = Date.now(),
): ConversationPlanState | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const title = normalizeText(record.title, MAX_PLAN_TITLE_CHARS);
    const planId = normalizeText(record.planId, MAX_PLAN_TITLE_CHARS);
    if (!title || !planId) return undefined;
    const now = normalizeTimestamp(record.updatedAt, fallbackNow);
    const currentStepId = normalizeText(record.currentStepId, MAX_PLAN_TITLE_CHARS);
    const steps = normalizePlanSteps(record.steps, now);
    return {
        version: 1,
        planId,
        revision: typeof record.revision === "number" && Number.isFinite(record.revision)
            ? Math.max(0, Math.floor(record.revision))
            : 0,
        status: normalizePlanStatus(record.status),
        title,
        ...(normalizeText(record.summary, MAX_PLAN_TEXT_CHARS) ? { summary: normalizeText(record.summary, MAX_PLAN_TEXT_CHARS) } : {}),
        mode: normalizePlanMode(record.mode),
        createdAt: normalizeTimestamp(record.createdAt, now),
        updatedAt: now,
        updatedBy: normalizeUpdatedBy(record.updatedBy),
        ...(currentStepId && steps.some((step) => step.id === currentStepId) ? { currentStepId } : {}),
        ...(normalizeText(record.nextAction, MAX_PLAN_TEXT_CHARS) ? { nextAction: normalizeText(record.nextAction, MAX_PLAN_TEXT_CHARS) } : {}),
        ...(normalizeText(record.blocker, MAX_PLAN_TEXT_CHARS) ? { blocker: normalizeText(record.blocker, MAX_PLAN_TEXT_CHARS) } : {}),
        steps,
    };
}

function updateStepCollection(
    steps: ConversationPlanStep[],
    nextStep: Omit<ConversationPlanStep, "updatedAt">,
    now: number,
): ConversationPlanStep[] {
    const normalized = normalizePlanStep(nextStep, now);
    if (!normalized) {
        return steps;
    }
    const remaining = steps.filter((item) => item.id !== normalized.id);
    const existingIndex = steps.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) {
        const next = [...steps];
        next.splice(existingIndex, 1, {
            ...steps[existingIndex],
            ...normalized,
            updatedAt: now,
        });
        return next.slice(0, MAX_PLAN_STEPS);
    }
    return [...remaining, normalized].slice(0, MAX_PLAN_STEPS);
}

function attachStepRef(
    steps: ConversationPlanStep[],
    stepId: string,
    ref: ConversationPlanRef,
    now: number,
): ConversationPlanStep[] {
    return steps.map((step) => {
        if (step.id !== stepId) return step;
        const refs = dedupePlanRefs([...(step.refs ?? []), ref]);
        return {
            ...step,
            refs,
            updatedAt: now,
        };
    });
}

function bumpRevision(
    plan: ConversationPlanState,
    now: number,
    updatedBy: ConversationPlanUpdatedBy,
): ConversationPlanState {
    return {
        ...plan,
        revision: plan.revision + 1,
        updatedAt: now,
        updatedBy,
    };
}

export function updateConversationPlanState(
    currentValue: ConversationPlanState | null | undefined,
    input: ConversationPlanUpdateInput,
    now: number = Date.now(),
): ConversationPlanUpdateResult {
    const current = currentValue ?? null;
    const updatedBy = normalizeUpdatedBy(input.updatedBy);
    if (typeof input.baseRevision === "number" && current && input.baseRevision !== current.revision) {
        return {
            applied: false,
            conflict: true,
            planState: current,
            reasonCode: "conflict",
            message: `Plan revision conflict: expected ${input.baseRevision}, current ${current.revision}.`,
        };
    }

    if (!Array.isArray(input.operations) || input.operations.length === 0) {
        return {
            applied: false,
            conflict: false,
            planState: current,
            reasonCode: "invalid_patch",
            message: "operations is required.",
        };
    }

    let working = current;
    if (!working) {
        if (input.ifAbsent === "reject") {
            return {
                applied: false,
                conflict: false,
                planState: null,
                reasonCode: "missing_plan",
                message: "No current plan exists.",
            };
        }
        const seed = normalizePlanSeed(input.seed);
        if (!seed && input.operations.every((operation) => operation.type !== "replace" && operation.type !== "clear")) {
            return {
                applied: false,
                conflict: false,
                planState: null,
                reasonCode: "missing_seed",
                message: "seed is required when creating a new plan.",
            };
        }
        working = buildEmptyPlan(seed, now, updatedBy);
    }

    let cleared = false;
    for (const operation of input.operations) {
        if (operation.type === "clear") {
            working = null;
            cleared = true;
            continue;
        }
        if (!working) {
            return {
                applied: false,
                conflict: false,
                planState: null,
                reasonCode: "missing_plan",
                message: "Plan was cleared before remaining operations were applied.",
                cleared,
            };
        }
        switch (operation.type) {
            case "replace": {
                const normalizedPlan = normalizeConversationPlanState({
                    ...operation.plan,
                    revision: 0,
                    createdAt: now,
                    updatedAt: now,
                    updatedBy,
                }, now);
                if (!normalizedPlan) {
                    return {
                        applied: false,
                        conflict: false,
                        planState: working,
                        reasonCode: "invalid_patch",
                        message: "replace plan is invalid.",
                    };
                }
                working = {
                    ...normalizedPlan,
                    revision: 0,
                    createdAt: now,
                    updatedAt: now,
                    updatedBy,
                };
                break;
            }
            case "set_header": {
                working = bumpRevision({
                    ...working,
                    ...(normalizeText(operation.title, MAX_PLAN_TITLE_CHARS) ? { title: normalizeText(operation.title, MAX_PLAN_TITLE_CHARS)! } : {}),
                    ...(typeof operation.summary === "string"
                        ? { summary: normalizeText(operation.summary, MAX_PLAN_TEXT_CHARS) }
                        : {}),
                }, now, updatedBy);
                break;
            }
            case "set_status": {
                working = bumpRevision({
                    ...working,
                    status: normalizePlanStatus(operation.status),
                    ...(typeof operation.blocker === "string"
                        ? { blocker: normalizeText(operation.blocker, MAX_PLAN_TEXT_CHARS) }
                        : {}),
                }, now, updatedBy);
                break;
            }
            case "set_focus": {
                const currentStepId = normalizeText(operation.currentStepId, MAX_PLAN_TITLE_CHARS);
                working = bumpRevision({
                    ...working,
                    ...(currentStepId && working.steps.some((step) => step.id === currentStepId) ? { currentStepId } : { currentStepId: undefined }),
                    ...(typeof operation.nextAction === "string"
                        ? { nextAction: normalizeText(operation.nextAction, MAX_PLAN_TEXT_CHARS) }
                        : {}),
                    ...(typeof operation.blocker === "string"
                        ? { blocker: normalizeText(operation.blocker, MAX_PLAN_TEXT_CHARS) }
                        : {}),
                }, now, updatedBy);
                break;
            }
            case "upsert_step": {
                working = bumpRevision({
                    ...working,
                    steps: updateStepCollection(working.steps, operation.step, now),
                }, now, updatedBy);
                break;
            }
            case "set_step_status": {
                const stepId = normalizeText(operation.stepId, MAX_PLAN_TITLE_CHARS);
                if (!stepId) {
                    return {
                        applied: false,
                        conflict: false,
                        planState: working,
                        reasonCode: "invalid_patch",
                        message: "set_step_status.stepId is required.",
                    };
                }
                working = bumpRevision({
                    ...working,
                    steps: working.steps.map((step) => step.id === stepId
                        ? {
                            ...step,
                            status: normalizeStepStatus(operation.status),
                            ...(typeof operation.blocker === "string"
                                ? { blocker: normalizeText(operation.blocker, MAX_PLAN_TEXT_CHARS) }
                                : {}),
                            updatedAt: now,
                        }
                        : step),
                }, now, updatedBy);
                break;
            }
            case "attach_ref": {
                const stepId = normalizeText(operation.stepId, MAX_PLAN_TITLE_CHARS);
                const ref = normalizePlanRef(operation.ref);
                if (!stepId || !ref) {
                    return {
                        applied: false,
                        conflict: false,
                        planState: working,
                        reasonCode: "invalid_patch",
                        message: "attach_ref requires valid stepId and ref.",
                    };
                }
                working = bumpRevision({
                    ...working,
                    steps: attachStepRef(working.steps, stepId, ref, now),
                }, now, updatedBy);
                break;
            }
        }
    }

    return {
        applied: true,
        conflict: false,
        planState: working,
        ...(cleared ? { cleared: true } : {}),
        reasonCode: "ok",
    };
}
