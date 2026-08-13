import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { getToolContractV2, readDelegationResultToolMetadata } from "@belldandy/skills";

import type { AgentRunEvent } from "./contracts.js";

const JOURNAL_VERSION = 1 as const;
const JOURNAL_DIRECTORY = "coding-run-reconciliation";
const DEFAULT_MAX_BYTES_PER_RUN = 1024 * 1024;
const MAX_DELEGATION_BINDINGS = 64;

type ConversationBinding = {
  conversationId: string;
  agentRunId: string;
};

export type CodingRunReconciliationOperation = {
  operationId: string;
  toolName: string;
  mutation: "none" | "possible" | "unknown";
  state: "none" | "started" | "applied" | "uncertain";
  startedSeq?: number;
  completedSeq?: number;
  evidence:
    | "tool_started"
    | "tool_completed_success"
    | "tool_completed_failure"
    | "completion_without_start"
    | "operation_identity_conflict"
    | "operation_outcome_conflict"
    | "delegation_binding_missing"
    | "delegation_binding_conflict"
    | "delegation_runtime_unavailable"
    | "delegation_child_not_done"
    | "delegation_children_applied"
    | "workspace_mutation_committed"
    | "workspace_mutation_incomplete"
    | "workspace_mutation_evidence_missing"
    | "workspace_mutation_evidence_conflict"
    | "workspace_mutation_evidence_unavailable";
};

export type CodingRunReconciliation = {
  state: "none" | "applied" | "uncertain";
  journalState: "available" | "missing" | "unavailable";
  observedOperationCount: number;
  mutationOperationCount: number;
  appliedOperationCount: number;
  uncertainOperationCount: number;
  lastJournalSeq?: number;
  reason?: "journal_missing" | "journal_unavailable" | "journal_invalid";
  operations: CodingRunReconciliationOperation[];
};

type RunStartedRecord = JournalRecordBase & {
  kind: "run.started";
};

type OperationRecord = JournalRecordBase & {
  kind: "operation.started" | "operation.completed";
  operationId: string;
  toolName: string;
  mutation: "none" | "possible" | "unknown";
  success?: boolean;
  delegationBindingState?: "complete" | "missing" | "invalid";
  delegationBindings?: string[];
};

type JournalRecord = RunStartedRecord | OperationRecord;

type OperationClassification = Pick<OperationRecord, "toolName" | "mutation">;

type JournalRecordBase = {
  version: typeof JOURNAL_VERSION;
  source: "conversation";
  conversationId: string;
  agentRunId: string;
  seq: number;
  timestampMs: number;
};

type DelegationTaskSnapshot = {
  id: string;
  kind: "sub_agent";
  parentConversationId: string;
  parentOperationId: string;
  sessionId?: string;
  status: "pending" | "running" | "done" | "error" | "timeout" | "stopped" | "interrupted";
};

type DelegationTaskStore = {
  listTasks(
    parentConversationId?: string,
    options?: { includeArchived?: boolean },
  ): Promise<unknown[]>;
};

type WorkspaceMutationOperationEvidence = {
  operationId: string;
  state: "prepared" | "committed" | "missing" | "conflict";
  workspaceCount: number;
  targetCount: number;
  committedTargetCount: number;
};

type WorkspaceMutationEvidenceStore = {
  getOperationEvidence(input: {
    revisionId: string;
    operationId: string;
  }): Promise<WorkspaceMutationOperationEvidence>;
};

type WorkspaceMutationEvidenceProjection = WorkspaceMutationOperationEvidence | "unavailable";

/**
 * Conversation tool side effect 的脱敏 append-only journal；不保存参数、输出或错误正文。
 */
export class CodingRunReconciliationJournal {
  private readonly journalDirectory: string;
  private readonly maxBytesPerRun: number;
  private readonly delegationTaskStore?: DelegationTaskStore;
  private readonly workspaceMutationEvidenceStore?: WorkspaceMutationEvidenceStore;
  private readonly operationClassifications = new Map<string, Map<string, OperationClassification>>();

  constructor(stateDir: string, options: {
    maxBytesPerRun?: number;
    delegationTaskStore?: DelegationTaskStore;
    workspaceMutationEvidenceStore?: WorkspaceMutationEvidenceStore;
  } = {}) {
    this.journalDirectory = path.join(path.resolve(stateDir), JOURNAL_DIRECTORY);
    this.maxBytesPerRun = normalizePositiveSafeInteger(
      options.maxBytesPerRun,
      DEFAULT_MAX_BYTES_PER_RUN,
      "maxBytesPerRun",
    );
    this.delegationTaskStore = options.delegationTaskStore;
    this.workspaceMutationEvidenceStore = options.workspaceMutationEvidenceStore;
  }

  record(event: AgentRunEvent): boolean {
    const binding = readConversationBinding(event);
    if (!binding) return false;
    const runKey = createRunKey(binding);
    if (isTerminalRunEvent(event.type)) {
      this.operationClassifications.delete(runKey);
      return false;
    }

    let record: JournalRecord | undefined;
    if (event.type === "run.started") {
      record = createRecordBase(event, binding, "run.started");
    } else if (event.type === "tool.started" || event.type === "tool.completed") {
      const operationId = readOperationId(event, binding);
      const cached = operationId
        ? this.operationClassifications.get(runKey)?.get(operationId)
        : undefined;
      record = createOperationRecord(event, binding, cached);
    }
    if (!record) return false;

    const serialized = Buffer.from(`${JSON.stringify(record)}\n`, "utf-8");
    const serializedBytes = serialized.byteLength;
    const filePath = this.resolveJournalPath(binding);
    fs.mkdirSync(this.journalDirectory, { recursive: true });
    const file = fs.openSync(filePath, "a", 0o600);
    try {
      if (fs.fstatSync(file).size + serializedBytes > this.maxBytesPerRun) {
        throw new Error("Coding run reconciliation journal capacity exceeded.");
      }
      let offset = 0;
      while (offset < serializedBytes) {
        const bytesWritten = fs.writeSync(file, serialized, offset, serializedBytes - offset, null);
        if (bytesWritten <= 0) {
          throw Object.assign(new Error("Coding run reconciliation journal write was incomplete."), { code: "EIO" });
        }
        offset += bytesWritten;
      }
      fs.fsyncSync(file);
    } finally {
      fs.closeSync(file);
    }
    if (record.kind === "operation.started") {
      let classifications = this.operationClassifications.get(runKey);
      if (!classifications) {
        classifications = new Map();
        this.operationClassifications.set(runKey, classifications);
      }
      classifications.set(record.operationId, {
        toolName: record.toolName,
        mutation: record.mutation,
      });
    }
    return true;
  }

  async reconcile(binding: ConversationBinding): Promise<CodingRunReconciliation> {
    if (!isConversationBinding(binding)) return unavailable("journal_invalid");
    const filePath = this.resolveJournalPath(binding);
    let raw: string;
    let file: fsp.FileHandle;
    try {
      file = await fsp.open(filePath, "r");
    } catch (error) {
      return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
        ? unavailable("journal_missing", "missing")
        : unavailable("journal_unavailable");
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > this.maxBytesPerRun) {
        return unavailable("journal_invalid");
      }
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const result = await file.read(buffer, offset, buffer.length - offset, offset);
        if (result.bytesRead <= 0) return unavailable("journal_unavailable");
        offset += result.bytesRead;
      }
      raw = buffer.toString("utf-8");
    } catch {
      return unavailable("journal_unavailable");
    } finally {
      await file.close().catch(() => undefined);
    }

    const records = parseJournal(raw, binding);
    if (!records || records[0]?.kind !== "run.started") {
      return unavailable("journal_invalid");
    }
    const delegationTasks = await this.readDelegationTasks(binding, records);
    const workspaceMutationEvidence = await this.readWorkspaceMutationEvidence(binding, records);
    return projectReconciliation(records, delegationTasks, workspaceMutationEvidence);
  }

  async remove(binding: ConversationBinding): Promise<boolean> {
    if (!isConversationBinding(binding)) return false;
    this.operationClassifications.delete(createRunKey(binding));
    try {
      await fsp.unlink(this.resolveJournalPath(binding));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return false;
      throw error;
    }
  }

  /** 启动时验证 journal 目录的创建、写入、fsync 与清理；不创建 run 记录。 */
  async checkReadiness(): Promise<boolean> {
    const probePath = path.join(this.journalDirectory, `.readiness-${process.pid}-${Date.now()}.tmp`);
    let file: fsp.FileHandle | undefined;
    try {
      await fsp.mkdir(this.journalDirectory, { recursive: true, mode: 0o700 });
      file = await fsp.open(probePath, "wx", 0o600);
      await file.writeFile("ready\n", "utf-8");
      await file.sync();
      await file.close();
      file = undefined;
      await fsp.unlink(probePath);
      return true;
    } catch {
      return false;
    } finally {
      await file?.close().catch(() => undefined);
      await fsp.unlink(probePath).catch(() => undefined);
    }
  }

  private resolveJournalPath(binding: ConversationBinding): string {
    const digest = createHash("sha256")
      .update(`conversation\0${binding.conversationId}\0${binding.agentRunId}`)
      .digest("hex");
    return path.join(this.journalDirectory, `conversation-${digest}.jsonl`);
  }

  private async readDelegationTasks(
    binding: ConversationBinding,
    records: JournalRecord[],
  ): Promise<DelegationTaskSnapshot[] | undefined> {
    if (!records.some((record) => record.kind !== "run.started" && isDelegationToolName(record.toolName))) {
      return [];
    }
    if (!this.delegationTaskStore) return undefined;
    let tasks: unknown[];
    try {
      tasks = await this.delegationTaskStore.listTasks(binding.conversationId, { includeArchived: true });
    } catch {
      return undefined;
    }
    return tasks
      .map((task) => readDelegationTaskSnapshot(task, binding.conversationId))
      .filter((task): task is DelegationTaskSnapshot => Boolean(task));
  }

  private async readWorkspaceMutationEvidence(
    binding: ConversationBinding,
    records: JournalRecord[],
  ): Promise<Map<string, WorkspaceMutationEvidenceProjection>> {
    const operationIds = [...new Set(records
      .filter((record): record is OperationRecord => (
        record.kind !== "run.started" && isWorkspaceMutationToolName(record.toolName)
      ))
      .map((record) => record.operationId))];
    const evidence = new Map<string, WorkspaceMutationEvidenceProjection>();
    await Promise.all(operationIds.map(async (operationId) => {
      if (!this.workspaceMutationEvidenceStore) {
        evidence.set(operationId, "unavailable");
        return;
      }
      try {
        const result = await this.workspaceMutationEvidenceStore.getOperationEvidence({
          revisionId: binding.agentRunId,
          operationId,
        });
        evidence.set(operationId, isWorkspaceMutationEvidence(result, operationId)
          ? result
          : {
              operationId,
              state: "conflict",
              workspaceCount: 0,
              targetCount: 0,
              committedTargetCount: 0,
            });
      } catch {
        evidence.set(operationId, "unavailable");
      }
    }));
    return evidence;
  }
}

export type CodingRunReconciliationJournalOwner = Pick<
  CodingRunReconciliationJournal,
  "record" | "reconcile"
> & Partial<Pick<CodingRunReconciliationJournal, "remove" | "checkReadiness">>;

function createRecordBase(
  event: AgentRunEvent,
  binding: ConversationBinding,
  kind: "run.started",
): RunStartedRecord {
  return {
    version: JOURNAL_VERSION,
    source: "conversation",
    conversationId: binding.conversationId,
    agentRunId: binding.agentRunId,
    seq: event.seq,
    timestampMs: event.timestampMs,
    kind,
  };
}

function createOperationRecord(
  event: AgentRunEvent,
  binding: ConversationBinding,
  cached?: OperationClassification,
): OperationRecord | undefined {
  const tool = readRecord(event.payload.tool);
  const toolCallId = readNonEmptyString(tool?.id);
  const rawToolName = readNonEmptyString(tool?.name);
  if (!toolCallId || !rawToolName) return undefined;
  const toolName = /^[A-Za-z0-9_.:-]{1,128}$/.test(rawToolName) ? rawToolName : "unknown";
  const mutation = cached?.toolName === toolName
    ? cached.mutation
    : classifyToolMutation(toolName, tool?.arguments);
  const base = {
    version: JOURNAL_VERSION,
    source: "conversation" as const,
    conversationId: binding.conversationId,
    agentRunId: binding.agentRunId,
    seq: event.seq,
    timestampMs: event.timestampMs,
    operationId: createConversationOperationId({ ...binding, toolCallId })!,
    toolName,
    mutation,
  };
  if (event.type === "tool.started") {
    return { ...base, kind: "operation.started" };
  }
  const delegationBinding = createDelegationBindingProjection(toolName, tool?.metadata);
  return typeof tool?.success === "boolean"
    ? {
        ...base,
        kind: "operation.completed",
        success: tool.success,
        ...delegationBinding,
      }
    : undefined;
}

function readOperationId(event: AgentRunEvent, binding: ConversationBinding): string | undefined {
  const toolCallId = readNonEmptyString(readRecord(event.payload.tool)?.id);
  return toolCallId ? createConversationOperationId({ ...binding, toolCallId }) : undefined;
}

export function createConversationOperationId(input: {
  conversationId: string;
  agentRunId: string;
  toolCallId: string;
}): string | undefined {
  const conversationId = readNonEmptyString(input.conversationId);
  const agentRunId = readNonEmptyString(input.agentRunId);
  const toolCallId = readNonEmptyString(input.toolCallId);
  if (!conversationId || !agentRunId || !toolCallId) return undefined;
  return `op_${createHash("sha256")
    .update(`conversation\0${conversationId}\0${agentRunId}\0${toolCallId}`)
    .digest("hex")}`;
}

function createRunKey(binding: ConversationBinding): string {
  return `${binding.conversationId}\0${binding.agentRunId}`;
}

function classifyToolMutation(toolName: string, argumentsValue: unknown): OperationRecord["mutation"] {
  if (toolName === "command_job") {
    const action = readNonEmptyString(readRecord(argumentsValue)?.action);
    if (action === "read" || action === "status" || action === "list") return "none";
    if (action === "start" || action === "write" || action === "resize" || action === "cancel") return "possible";
    return "unknown";
  }
  const contract = toolName === "unknown" ? undefined : getToolContractV2(toolName);
  return contract ? (contract.isReadOnly ? "none" : "possible") : "unknown";
}

function isDelegationToolName(toolName: string): toolName is "delegate_task" | "delegate_parallel" {
  return toolName === "delegate_task" || toolName === "delegate_parallel";
}

function isWorkspaceMutationToolName(toolName: string): boolean {
  return toolName === "file_write" || toolName === "file_delete" || toolName === "apply_patch";
}

function isWorkspaceMutationEvidence(
  value: unknown,
  operationId: string,
): value is WorkspaceMutationOperationEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceMutationOperationEvidence>;
  if (candidate.operationId !== operationId
    || (candidate.state !== "prepared"
      && candidate.state !== "committed"
      && candidate.state !== "missing"
      && candidate.state !== "conflict")
    || !isSafeInteger(candidate.workspaceCount)
    || !isSafeInteger(candidate.targetCount)
    || !isSafeInteger(candidate.committedTargetCount)
    || candidate.committedTargetCount > candidate.targetCount) {
    return false;
  }
  if (candidate.state === "missing") {
    return candidate.workspaceCount === 0
      && candidate.targetCount === 0
      && candidate.committedTargetCount === 0;
  }
  if (candidate.state === "prepared") {
    return candidate.workspaceCount > 0
      && candidate.targetCount > 0
      && candidate.committedTargetCount < candidate.targetCount;
  }
  if (candidate.state === "committed") {
    return candidate.workspaceCount > 0
      && candidate.targetCount > 0
      && candidate.committedTargetCount === candidate.targetCount;
  }
  return true;
}

function createDelegationBindingProjection(
  toolName: string,
  metadata: unknown,
): Partial<Pick<OperationRecord, "delegationBindingState" | "delegationBindings">> {
  if (!isDelegationToolName(toolName)) return {};
  const parsed = readDelegationResultToolMetadata(metadata);
  if (!parsed) {
    return { delegationBindingState: "missing", delegationBindings: [] };
  }
  if (parsed.delegationResults.length > MAX_DELEGATION_BINDINGS) {
    return { delegationBindingState: "invalid", delegationBindings: [] };
  }
  const delegationBindings: string[] = [];
  for (const result of parsed.delegationResults) {
    const bindingId = createDelegationChildBindingId(result.taskId, result.sessionId);
    if (!bindingId) {
      return { delegationBindingState: "invalid", delegationBindings: [] };
    }
    delegationBindings.push(bindingId);
  }
  return {
    delegationBindingState: delegationBindings.length > 0 ? "complete" : "missing",
    delegationBindings,
  };
}

function createDelegationChildBindingId(taskIdValue: unknown, sessionIdValue: unknown): string | undefined {
  const taskId = readNonEmptyString(taskIdValue);
  if (!taskId) return undefined;
  const sessionId = readNonEmptyString(sessionIdValue) ?? "";
  return `child_${createHash("sha256")
    .update(`subtask\0${taskId}\0${sessionId}`)
    .digest("hex")}`;
}

function readDelegationTaskSnapshot(
  value: unknown,
  parentConversationId: string,
): DelegationTaskSnapshot | undefined {
  const record = readRecord(value);
  if (!record
    || record.kind !== "sub_agent"
    || record.parentConversationId !== parentConversationId
    || !/^op_[a-f0-9]{64}$/.test(String(record.parentOperationId))) {
    return undefined;
  }
  const id = readNonEmptyString(record.id);
  const status = readDelegationTaskStatus(record.status);
  if (!id || !status) return undefined;
  return {
    id,
    kind: "sub_agent",
    parentConversationId,
    parentOperationId: String(record.parentOperationId),
    ...(readNonEmptyString(record.sessionId) ? { sessionId: readNonEmptyString(record.sessionId) } : {}),
    status,
  };
}

function readDelegationTaskStatus(value: unknown): DelegationTaskSnapshot["status"] | undefined {
  switch (value) {
    case "pending":
    case "running":
    case "done":
    case "error":
    case "timeout":
    case "stopped":
    case "interrupted":
      return value;
    default:
      return undefined;
  }
}

function projectDelegationOutcome(
  record: OperationRecord,
  delegationTasks: DelegationTaskSnapshot[] | undefined,
  missingStart: boolean,
): Pick<CodingRunReconciliationOperation, "state" | "evidence"> {
  if (missingStart) {
    return { state: "uncertain", evidence: "completion_without_start" };
  }
  if (record.delegationBindingState === undefined || record.delegationBindingState === "missing") {
    return { state: "uncertain", evidence: "delegation_binding_missing" };
  }
  const expectedBindings = record.delegationBindings ?? [];
  if (record.delegationBindingState === "invalid"
    || expectedBindings.length === 0
    || new Set(expectedBindings).size !== expectedBindings.length
    || (record.toolName === "delegate_task" && expectedBindings.length !== 1)) {
    return { state: "uncertain", evidence: "delegation_binding_conflict" };
  }
  if (!delegationTasks) {
    return { state: "uncertain", evidence: "delegation_runtime_unavailable" };
  }
  const authoritativeTasks = delegationTasks.filter((task) => task.parentOperationId === record.operationId);
  if (authoritativeTasks.length === 0) {
    return { state: "uncertain", evidence: "delegation_binding_missing" };
  }
  const authoritativeBindings = authoritativeTasks
    .map((task) => createDelegationChildBindingId(task.id, task.sessionId))
    .filter((binding): binding is string => Boolean(binding));
  const expectedSet = new Set(expectedBindings);
  if (authoritativeBindings.length !== expectedBindings.length
    || new Set(authoritativeBindings).size !== authoritativeBindings.length
    || authoritativeBindings.some((binding) => !expectedSet.has(binding))) {
    return { state: "uncertain", evidence: "delegation_binding_conflict" };
  }
  if (authoritativeTasks.some((task) => task.status !== "done")) {
    return { state: "uncertain", evidence: "delegation_child_not_done" };
  }
  return { state: "applied", evidence: "delegation_children_applied" };
}

function projectWorkspaceMutationOutcome(
  record: OperationRecord,
  evidenceByOperation: ReadonlyMap<string, WorkspaceMutationEvidenceProjection>,
  missingStart: boolean,
): Pick<CodingRunReconciliationOperation, "state" | "evidence"> {
  if (missingStart) {
    return { state: "uncertain", evidence: "completion_without_start" };
  }
  const evidence = evidenceByOperation.get(record.operationId);
  if (!evidence || evidence === "unavailable") {
    return { state: "uncertain", evidence: "workspace_mutation_evidence_unavailable" };
  }
  switch (evidence.state) {
    case "committed":
      return { state: "applied", evidence: "workspace_mutation_committed" };
    case "prepared":
      return { state: "uncertain", evidence: "workspace_mutation_incomplete" };
    case "missing":
      return { state: "uncertain", evidence: "workspace_mutation_evidence_missing" };
    case "conflict":
      return { state: "uncertain", evidence: "workspace_mutation_evidence_conflict" };
  }
}

function isTerminalRunEvent(type: AgentRunEvent["type"]): boolean {
  return type === "run.cancelled"
    || type === "run.interrupted"
    || type === "run.completed"
    || type === "run.failed";
}

function parseJournal(raw: string, binding: ConversationBinding): JournalRecord[] | undefined {
  const records: JournalRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!isJournalRecord(parsed, binding)) return undefined;
    records.push(parsed);
  }
  return records;
}

function isJournalRecord(value: unknown, binding: ConversationBinding): value is JournalRecord {
  if (!readRecord(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== JOURNAL_VERSION
    || record.source !== "conversation"
    || record.conversationId !== binding.conversationId
    || record.agentRunId !== binding.agentRunId
    || !isSafeInteger(record.seq)
    || !isSafeInteger(record.timestampMs)) {
    return false;
  }
  if (record.kind === "run.started") {
    return hasExactKeys(record, [
      "version", "source", "conversationId", "agentRunId", "seq", "timestampMs", "kind",
    ]);
  }
  const operationFieldsValid = (record.kind === "operation.started" || record.kind === "operation.completed")
    && /^op_[a-f0-9]{64}$/.test(String(record.operationId))
    && /^[A-Za-z0-9_.:-]{1,128}$/.test(String(record.toolName))
    && (record.mutation === "none" || record.mutation === "possible" || record.mutation === "unknown")
    && (record.kind === "operation.started" || typeof record.success === "boolean");
  if (!operationFieldsValid) return false;
  const hasDelegationBindingState = Object.prototype.hasOwnProperty.call(record, "delegationBindingState");
  const hasDelegationBindings = Object.prototype.hasOwnProperty.call(record, "delegationBindings");
  if (hasDelegationBindingState !== hasDelegationBindings) return false;
  if (hasDelegationBindingState) {
    if (record.kind !== "operation.completed"
      || !isDelegationToolName(String(record.toolName))
      || (record.delegationBindingState !== "complete"
        && record.delegationBindingState !== "missing"
        && record.delegationBindingState !== "invalid")
      || !Array.isArray(record.delegationBindings)
      || record.delegationBindings.length > MAX_DELEGATION_BINDINGS
      || !record.delegationBindings.every((item) => /^child_[a-f0-9]{64}$/.test(String(item)))) {
      return false;
    }
  }
  return hasExactKeys(record, record.kind === "operation.started"
    ? [
      "version", "source", "conversationId", "agentRunId", "seq", "timestampMs", "kind",
      "operationId", "toolName", "mutation",
    ]
    : [
      "version", "source", "conversationId", "agentRunId", "seq", "timestampMs", "kind",
      "operationId", "toolName", "mutation", "success",
      ...(hasDelegationBindingState ? ["delegationBindingState", "delegationBindings"] : []),
    ]);
}

function projectReconciliation(
  records: JournalRecord[],
  delegationTasks: DelegationTaskSnapshot[] | undefined,
  workspaceMutationEvidence: ReadonlyMap<string, WorkspaceMutationEvidenceProjection>,
): CodingRunReconciliation {
  const operations = new Map<string, CodingRunReconciliationOperation>();
  const completionOutcomes = new Map<string, boolean>();
  for (const record of records) {
    if (record.kind === "run.started") continue;
    const current = operations.get(record.operationId);
    if (current?.evidence === "operation_identity_conflict"
      || current?.evidence === "operation_outcome_conflict") {
      continue;
    }
    if (current && (current.toolName !== record.toolName || current.mutation !== record.mutation)) {
      operations.set(record.operationId, {
        operationId: record.operationId,
        toolName: "unknown",
        mutation: "unknown",
        state: "uncertain",
        ...(current.startedSeq === undefined ? {} : { startedSeq: current.startedSeq }),
        ...(record.kind === "operation.completed" ? { completedSeq: record.seq } : {}),
        evidence: "operation_identity_conflict",
      });
      continue;
    }
    if (record.kind === "operation.started") {
      if (!current) {
        const workspaceEvidence = workspaceMutationEvidence.get(record.operationId);
        const workspaceMutationOutcome = isWorkspaceMutationToolName(record.toolName)
          && workspaceEvidence !== undefined
          && workspaceEvidence !== "unavailable"
          ? projectWorkspaceMutationOutcome(record, workspaceMutationEvidence, false)
          : undefined;
        operations.set(record.operationId, {
          operationId: record.operationId,
          toolName: record.toolName,
          mutation: record.mutation,
          state: workspaceMutationOutcome?.state ?? "started",
          startedSeq: record.seq,
          evidence: workspaceMutationOutcome?.evidence ?? "tool_started",
        });
      }
      continue;
    }
    const completionSuccess = record.success === true;
    const previousCompletionSuccess = completionOutcomes.get(record.operationId);
    if (previousCompletionSuccess !== undefined && previousCompletionSuccess !== completionSuccess) {
      operations.set(record.operationId, {
        operationId: record.operationId,
        toolName: record.toolName,
        mutation: record.mutation,
        state: "uncertain",
        ...(current?.startedSeq === undefined ? {} : { startedSeq: current.startedSeq }),
        completedSeq: record.seq,
        evidence: "operation_outcome_conflict",
      });
      continue;
    }
    completionOutcomes.set(record.operationId, completionSuccess);
    const missingStart = !current;
    const delegationOutcome = completionSuccess && isDelegationToolName(record.toolName)
      ? projectDelegationOutcome(record, delegationTasks, missingStart)
      : undefined;
    const workspaceMutationOutcome = completionSuccess && isWorkspaceMutationToolName(record.toolName)
      ? projectWorkspaceMutationOutcome(record, workspaceMutationEvidence, missingStart)
      : undefined;
    const uncertain = missingStart
      || record.mutation === "unknown"
      || !completionSuccess
      || delegationOutcome?.state === "uncertain"
      || workspaceMutationOutcome?.state === "uncertain";
    operations.set(record.operationId, {
      operationId: record.operationId,
      toolName: record.toolName,
      mutation: record.mutation,
      state: record.mutation === "none" ? "none" : uncertain ? "uncertain" : "applied",
      ...(current?.startedSeq === undefined ? {} : { startedSeq: current.startedSeq }),
      completedSeq: record.seq,
      evidence: missingStart
        ? "completion_without_start"
        : !completionSuccess
          ? "tool_completed_failure"
          : delegationOutcome?.evidence
            ?? workspaceMutationOutcome?.evidence
            ?? "tool_completed_success",
    });
  }

  const projected = [...operations.values()].sort((left, right) =>
    (left.startedSeq ?? left.completedSeq ?? 0) - (right.startedSeq ?? right.completedSeq ?? 0)
  );
  const mutationOperations = projected.filter((operation) => operation.mutation !== "none");
  const appliedOperationCount = mutationOperations.filter((operation) => operation.state === "applied").length;
  const uncertainOperationCount = mutationOperations.filter((operation) => operation.state !== "applied").length;
  return {
    state: uncertainOperationCount > 0 ? "uncertain" : appliedOperationCount > 0 ? "applied" : "none",
    journalState: "available",
    observedOperationCount: projected.length,
    mutationOperationCount: mutationOperations.length,
    appliedOperationCount,
    uncertainOperationCount,
    lastJournalSeq: Math.max(...records.map((record) => record.seq)),
    operations: projected,
  };
}

function unavailable(
  reason: CodingRunReconciliation["reason"],
  journalState: "missing" | "unavailable" = "unavailable",
): CodingRunReconciliation {
  return {
    state: "uncertain",
    journalState,
    observedOperationCount: 0,
    mutationOperationCount: 0,
    appliedOperationCount: 0,
    uncertainOperationCount: 1,
    reason,
    operations: [],
  };
}

export function createUnavailableCodingRunReconciliation(
  reason: "journal_missing" | "journal_unavailable" | "journal_invalid" = "journal_unavailable",
): CodingRunReconciliation {
  return unavailable(reason, reason === "journal_missing" ? "missing" : "unavailable");
}

function readConversationBinding(event: AgentRunEvent): ConversationBinding | undefined {
  if (event.source !== "conversation") return undefined;
  const binding = {
    conversationId: event.binding.conversationId ?? "",
    agentRunId: event.binding.agentRunId,
  };
  return isConversationBinding(binding) ? binding : undefined;
}

function isConversationBinding(value: ConversationBinding): boolean {
  return Boolean(readNonEmptyString(value.conversationId) && readNonEmptyString(value.agentRunId));
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(record: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(record);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function normalizePositiveSafeInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}
