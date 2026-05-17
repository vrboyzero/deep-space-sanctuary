import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type GoalRuntimeBindingSource =
  | "goal_session"
  | "goal_subtask"
  | "goal_verifier"
  | "bridge_session";

export type GoalRuntimeBindingRecord = {
  id: string;
  source: GoalRuntimeBindingSource;
  goalId: string;
  nodeId?: string;
  runId?: string;
  agentId?: string;
  profileId?: string;
  role?: "default" | "coder" | "researcher" | "verifier";
  conversationId?: string;
  parentConversationId?: string;
  sessionId?: string;
  taskId?: string;
  planId?: string;
  status: string;
  scopeKeys: {
    goal: string;
    node?: string;
    run?: string;
    agent?: string;
  };
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

type GoalRuntimeBindingState = {
  version: 1;
  items: GoalRuntimeBindingRecord[];
};

type GoalRuntimeBindingLogger = {
  warn?: (message: string, data?: unknown) => void;
};

const STATE_VERSION = 1 as const;
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeStatus(value: unknown): string {
  return normalizeText(value) || "unknown";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function atomicWriteJson(targetPath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  let lastErr: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await fs.rename(tmpPath, targetPath);
      return;
    } catch (error) {
      lastErr = error as NodeJS.ErrnoException;
      if (attempt < RENAME_RETRIES - 1) {
        await delay(RENAME_RETRY_DELAY_MS);
      }
    }
  }
  if (process.platform === "win32" && lastErr && (lastErr.code === "EPERM" || lastErr.code === "EBUSY")) {
    try {
      await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
      await fs.unlink(tmpPath).catch(() => {});
      return;
    } catch (fallbackError) {
      await fs.unlink(tmpPath).catch(() => {});
      throw fallbackError;
    }
  }
  await fs.unlink(tmpPath).catch(() => {});
  throw lastErr;
}

function buildScopeKeys(input: {
  goalId: string;
  nodeId?: string;
  runId?: string;
  agentId?: string;
}): GoalRuntimeBindingRecord["scopeKeys"] {
  const goal = `goal:${input.goalId}`;
  const node = input.nodeId ? `${goal}:node:${input.nodeId}` : undefined;
  const run = node && input.runId ? `${node}:run:${input.runId}` : undefined;
  const agent = input.agentId
    ? `${run ?? node ?? goal}:agent:${input.agentId}`
    : undefined;
  return {
    goal,
    ...(node ? { node } : {}),
    ...(run ? { run } : {}),
    ...(agent ? { agent } : {}),
  };
}

function cloneRecord(record: GoalRuntimeBindingRecord): GoalRuntimeBindingRecord {
  return {
    ...record,
    scopeKeys: {
      ...record.scopeKeys,
    },
  };
}

export class GoalRuntimeBindingStore {
  private readonly statePath: string;
  private readonly logger?: GoalRuntimeBindingLogger;
  private readonly records = new Map<string, GoalRuntimeBindingRecord>();
  private loadPromise: Promise<void> | null = null;
  private writeChain = Promise.resolve();

  constructor(stateDir: string, logger?: GoalRuntimeBindingLogger) {
    this.statePath = path.join(stateDir, "goals", "runtime-bindings.json");
    this.logger = logger;
  }

  async load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.loadPromise = (async () => {
      this.records.clear();
      try {
        const raw = await fs.readFile(this.statePath, "utf-8");
        const parsed = JSON.parse(stripUtf8Bom(raw)) as Partial<GoalRuntimeBindingState>;
        for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
          const record = this.normalizeRecord(item);
          if (record) {
            this.records.set(record.id, record);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
          this.logger?.warn?.("Failed to load goal runtime bindings, starting fresh.", error);
        }
      }
    })();
    return this.loadPromise;
  }

  async listBindings(filter?: {
    goalId?: string;
    taskId?: string;
    source?: GoalRuntimeBindingSource;
  }): Promise<GoalRuntimeBindingRecord[]> {
    await this.load();
    const items = [...this.records.values()]
      .filter((record) => {
        if (filter?.goalId && record.goalId !== filter.goalId) return false;
        if (filter?.taskId && record.taskId !== filter.taskId) return false;
        if (filter?.source && record.source !== filter.source) return false;
        return true;
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return items.map((item) => cloneRecord(item));
  }

  async getBinding(id: string): Promise<GoalRuntimeBindingRecord | undefined> {
    await this.load();
    const record = this.records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  async upsertGoalSession(input: {
    goalId: string;
    nodeId?: string;
    runId?: string;
    conversationId: string;
    agentId?: string;
    status: string;
    finishedAt?: string;
  }): Promise<GoalRuntimeBindingRecord> {
    await this.load();
    const bindingId = `goal-session:${input.conversationId}`;
    return this.mutate(async () => {
      const now = new Date().toISOString();
      const current = this.records.get(bindingId);
      const next: GoalRuntimeBindingRecord = {
        id: bindingId,
        source: "goal_session",
        goalId: input.goalId,
        nodeId: normalizeText(input.nodeId),
        runId: normalizeText(input.runId),
        agentId: normalizeText(input.agentId),
        conversationId: input.conversationId,
        status: normalizeStatus(input.status),
        scopeKeys: buildScopeKeys({
          goalId: input.goalId,
          nodeId: normalizeText(input.nodeId),
          runId: normalizeText(input.runId),
          agentId: normalizeText(input.agentId),
        }),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        finishedAt: normalizeText(input.finishedAt),
      };
      this.records.set(bindingId, next);
      return cloneRecord(next);
    });
  }

  async upsertSubTaskBinding(input: {
    source: GoalRuntimeBindingSource;
    goalId: string;
    nodeId?: string;
    runId?: string;
    taskId: string;
    agentId?: string;
    profileId?: string;
    role?: "default" | "coder" | "researcher" | "verifier";
    conversationId?: string;
    parentConversationId?: string;
    sessionId?: string;
    planId?: string;
    status: string;
    finishedAt?: string;
  }): Promise<GoalRuntimeBindingRecord> {
    await this.load();
    const bindingId = `subtask:${input.taskId}`;
    return this.mutate(async () => {
      const now = new Date().toISOString();
      const current = this.records.get(bindingId);
      const next: GoalRuntimeBindingRecord = {
        id: bindingId,
        source: input.source,
        goalId: input.goalId,
        nodeId: normalizeText(input.nodeId),
        runId: normalizeText(input.runId),
        agentId: normalizeText(input.agentId),
        profileId: normalizeText(input.profileId),
        role: input.role,
        conversationId: normalizeText(input.conversationId),
        parentConversationId: normalizeText(input.parentConversationId),
        sessionId: normalizeText(input.sessionId),
        taskId: input.taskId,
        planId: normalizeText(input.planId),
        status: normalizeStatus(input.status),
        scopeKeys: buildScopeKeys({
          goalId: input.goalId,
          nodeId: normalizeText(input.nodeId),
          runId: normalizeText(input.runId),
          agentId: normalizeText(input.agentId),
        }),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        finishedAt: normalizeText(input.finishedAt),
      };
      this.records.set(bindingId, next);
      return cloneRecord(next);
    });
  }

  private async mutate<TResult>(updater: () => Promise<TResult>): Promise<TResult> {
    let result!: TResult;
    const execute = this.writeChain.then(async () => {
      result = await updater();
      await atomicWriteJson(this.statePath, {
        version: STATE_VERSION,
        items: [...this.records.values()],
      } satisfies GoalRuntimeBindingState);
    });
    this.writeChain = execute.catch(() => {});
    await execute;
    return result;
  }

  private normalizeRecord(value: unknown): GoalRuntimeBindingRecord | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const source = normalizeText((value as Record<string, unknown>).source) as GoalRuntimeBindingSource | undefined;
    const goalId = normalizeText((value as Record<string, unknown>).goalId);
    const id = normalizeText((value as Record<string, unknown>).id);
    const createdAt = normalizeText((value as Record<string, unknown>).createdAt);
    const updatedAt = normalizeText((value as Record<string, unknown>).updatedAt);
    const status = normalizeText((value as Record<string, unknown>).status);
    if (!id || !goalId || !createdAt || !updatedAt || !status) {
      return undefined;
    }
    if (source !== "goal_session" && source !== "goal_subtask" && source !== "goal_verifier" && source !== "bridge_session") {
      return undefined;
    }
    const agentId = normalizeText((value as Record<string, unknown>).agentId);
    return {
      id,
      source,
      goalId,
      nodeId: normalizeText((value as Record<string, unknown>).nodeId),
      runId: normalizeText((value as Record<string, unknown>).runId),
      agentId,
      profileId: normalizeText((value as Record<string, unknown>).profileId),
      role: (value as Record<string, unknown>).role === "default"
        || (value as Record<string, unknown>).role === "coder"
        || (value as Record<string, unknown>).role === "researcher"
        || (value as Record<string, unknown>).role === "verifier"
        ? (value as Record<string, unknown>).role as GoalRuntimeBindingRecord["role"]
        : undefined,
      conversationId: normalizeText((value as Record<string, unknown>).conversationId),
      parentConversationId: normalizeText((value as Record<string, unknown>).parentConversationId),
      sessionId: normalizeText((value as Record<string, unknown>).sessionId),
      taskId: normalizeText((value as Record<string, unknown>).taskId),
      planId: normalizeText((value as Record<string, unknown>).planId),
      status,
      scopeKeys: buildScopeKeys({
        goalId,
        nodeId: normalizeText((value as Record<string, unknown>).nodeId),
        runId: normalizeText((value as Record<string, unknown>).runId),
        agentId,
      }),
      createdAt,
      updatedAt,
      finishedAt: normalizeText((value as Record<string, unknown>).finishedAt),
    };
  }
}
