import type { AgentPromptSnapshot } from "@belldandy/agent";

export type PromptSnapshotRecord = AgentPromptSnapshot;

export class PromptSnapshotStore {
  private readonly maxSnapshots: number;
  private readonly records = new Map<string, PromptSnapshotRecord>();
  private readonly order: string[] = [];
  private readonly keysByConversation = new Map<string, string[]>();
  private readonly keysByAgent = new Map<string, string[]>();
  private readonly keyByRunId = new Map<string, string>();
  private autoId = 0;

  constructor(options: { maxSnapshots?: number } = {}) {
    this.maxSnapshots = Math.max(1, Math.floor(options.maxSnapshots ?? 32));
  }

  save(snapshot: AgentPromptSnapshot): PromptSnapshotRecord {
    const key = this.buildKey(snapshot);
    const previous = this.records.get(key);
    if (previous) {
      this.detachKey(key, previous);
    }

    const cloned = clonePromptSnapshot(snapshot);
    this.records.set(key, cloned);
    this.order.push(key);
    appendIndex(this.keysByConversation, cloned.conversationId, key);
    if (cloned.agentId) {
      appendIndex(this.keysByAgent, cloned.agentId, key);
    }
    if (cloned.runId) {
      this.keyByRunId.set(cloned.runId, key);
    }

    this.trimToLimit();
    return clonePromptSnapshot(cloned);
  }

  get(input: {
    conversationId?: string;
    runId?: string;
    agentId?: string;
  } = {}): PromptSnapshotRecord | undefined {
    const conversationId = normalizeOptionalString(input.conversationId);
    const runId = normalizeOptionalString(input.runId);
    const agentId = normalizeOptionalString(input.agentId);

    if (conversationId && runId) {
      return cloneOptionalPromptSnapshot(this.records.get(buildPromptSnapshotRunKey(conversationId, runId)));
    }

    if (runId) {
      const key = this.keyByRunId.get(runId);
      const record = key ? this.records.get(key) : undefined;
      if (!record) {
        return undefined;
      }
      if (conversationId && record.conversationId !== conversationId) {
        return undefined;
      }
      if (agentId && record.agentId !== agentId) {
        return undefined;
      }
      return clonePromptSnapshot(record);
    }

    if (conversationId) {
      return this.findLatestFromIndex(this.keysByConversation.get(conversationId), agentId);
    }

    if (agentId) {
      return this.findLatestFromIndex(this.keysByAgent.get(agentId));
    }

    return this.findLatestFromIndex(this.order);
  }

  getPrevious(input: {
    conversationId: string;
    runId?: string;
    agentId?: string;
  }): PromptSnapshotRecord | undefined {
    const conversationId = normalizeOptionalString(input.conversationId);
    const runId = normalizeOptionalString(input.runId);
    const agentId = normalizeOptionalString(input.agentId);
    if (!conversationId) {
      return undefined;
    }
    return this.findPreviousFromIndex(this.keysByConversation.get(conversationId), {
      runId,
      agentId,
    });
  }

  private buildKey(snapshot: AgentPromptSnapshot): string {
    if (snapshot.runId) {
      return buildPromptSnapshotRunKey(snapshot.conversationId, snapshot.runId);
    }
    this.autoId += 1;
    return `prompt-snapshot:${snapshot.conversationId}:${snapshot.createdAt}:${this.autoId}`;
  }

  private findLatestFromIndex(keys?: string[], agentId?: string): PromptSnapshotRecord | undefined {
    if (!keys || keys.length === 0) {
      return undefined;
    }

    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const record = this.records.get(key);
      if (!record) {
        continue;
      }
      if (agentId && record.agentId !== agentId) {
        continue;
      }
      return clonePromptSnapshot(record);
    }

    return undefined;
  }

  private findPreviousFromIndex(
    keys: string[] | undefined,
    input: {
      runId?: string;
      agentId?: string;
    },
  ): PromptSnapshotRecord | undefined {
    if (!keys || keys.length === 0) {
      return undefined;
    }

    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const record = this.records.get(key);
      if (!record) {
        continue;
      }
      if (input.runId && record.runId === input.runId) {
        continue;
      }
      if (input.agentId && record.agentId !== input.agentId) {
        continue;
      }
      return clonePromptSnapshot(record);
    }

    return undefined;
  }

  private trimToLimit(): void {
    while (this.order.length > this.maxSnapshots) {
      const oldestKey = this.order.shift();
      if (!oldestKey) {
        return;
      }
      const record = this.records.get(oldestKey);
      if (!record) {
        continue;
      }
      this.records.delete(oldestKey);
      this.detachIndexes(oldestKey, record);
    }
  }

  private detachKey(key: string, record: PromptSnapshotRecord): void {
    this.records.delete(key);
    removeIndexedValue(this.order, key);
    this.detachIndexes(key, record);
  }

  private detachIndexes(key: string, record: PromptSnapshotRecord): void {
    removeIndexedValue(this.keysByConversation.get(record.conversationId), key);
    if (record.agentId) {
      removeIndexedValue(this.keysByAgent.get(record.agentId), key);
    }
    if (record.runId) {
      const currentKey = this.keyByRunId.get(record.runId);
      if (currentKey === key) {
        this.keyByRunId.delete(record.runId);
      }
    }
  }
}

function buildPromptSnapshotRunKey(conversationId: string, runId: string): string {
  return `prompt-snapshot:${conversationId}:run:${runId}`;
}

function appendIndex(index: Map<string, string[]>, id: string, key: string): void {
  const existing = index.get(id);
  if (existing) {
    existing.push(key);
    return;
  }
  index.set(id, [key]);
}

function removeIndexedValue(values: string[] | undefined, target: string): void {
  if (!values || values.length === 0) {
    return;
  }
  const index = values.lastIndexOf(target);
  if (index >= 0) {
    values.splice(index, 1);
  }
}

function clonePromptSnapshot(snapshot: AgentPromptSnapshot): PromptSnapshotRecord {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) => ({
      ...message,
      content: Array.isArray(message.content)
        ? message.content.map((part) => ({ ...part }))
        : message.content,
    })),
    providerNativeSystemBlocks: snapshot.providerNativeSystemBlocks?.map((block) => ({
      ...block,
      sourceSectionIds: [...block.sourceSectionIds],
      sourceDeltaIds: [...block.sourceDeltaIds],
    })),
    inputMeta: snapshot.inputMeta ? { ...snapshot.inputMeta } : undefined,
  };
}

function cloneOptionalPromptSnapshot(snapshot: AgentPromptSnapshot | undefined): PromptSnapshotRecord | undefined {
  return snapshot ? clonePromptSnapshot(snapshot) : undefined;
}

function normalizeOptionalString(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}
