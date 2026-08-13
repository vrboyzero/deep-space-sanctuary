import {
  SubTaskSupervisorAdmissionError,
  type SubTaskSupervisorExactBinding,
  type SubTaskSupervisorRuntime,
  type SubTaskSupervisorRuntimeItem,
} from "./subtask-supervisor-runtime.js";
import type {
  SubTaskChangeEvent,
  SubTaskCommandRequestOptions,
  SubTaskRecord,
  SubTaskRuntimeStore,
} from "./task-runtime.js";
import type { SubTaskSupervisorControlInput } from "@belldandy/skills";

export type SubTaskSupervisorCancelInput = SubTaskCommandRequestOptions & {
  binding: SubTaskSupervisorExactBinding;
  reason?: string;
};

export type SubTaskSupervisorSteerInput = SubTaskCommandRequestOptions & {
  binding: SubTaskSupervisorExactBinding;
  message: string;
};

export class SubTaskSupervisorControlRuntime {
  private readonly unsubscribe: () => void;

  constructor(private readonly input: {
    runtimeStore: Pick<SubTaskRuntimeStore, "getTask" | "subscribe">;
    supervisorRuntime: Pick<SubTaskSupervisorRuntime, "observe" | "reconcile">;
    cancelSubTask?: (
      taskId: string,
      reason?: string,
      options?: SubTaskCommandRequestOptions,
    ) => Promise<SubTaskRecord | undefined>;
    steerSubTask?: (
      taskId: string,
      message: string,
      options?: SubTaskCommandRequestOptions,
    ) => Promise<SubTaskRecord | undefined>;
  }) {
    this.unsubscribe = input.runtimeStore.subscribe((event) => this.reconcileEvent(event));
  }

  async observe(binding: SubTaskSupervisorExactBinding): Promise<SubTaskSupervisorRuntimeItem | undefined> {
    return (await this.readExactRecord(binding))?.observation;
  }

  async control(input: SubTaskSupervisorControlInput): Promise<SubTaskSupervisorRuntimeItem | undefined> {
    const binding: SubTaskSupervisorExactBinding = {
      managerConversationId: input.managerConversationId,
      managerAgentRunId: input.managerAgentRunId,
      teamId: input.teamId,
      laneId: input.laneId,
      taskId: input.taskId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };
    if (input.action === "observe") return this.observe(binding);
    if (input.action === "cancel") {
      return this.cancel({
        binding,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      });
    }
    return this.steer({
      binding,
      message: input.message ?? "",
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async cancel(input: SubTaskSupervisorCancelInput): Promise<SubTaskSupervisorRuntimeItem | undefined> {
    requireCurrentSessionBinding(input.binding, "cancel");
    const exact = await this.readExactRecord(input.binding);
    if (!exact) return undefined;
    if (!this.input.cancelSubTask) {
      throw new Error("Subtask Supervisor cancel controller is unavailable.");
    }
    const updated = await this.input.cancelSubTask(exact.record.id, input.reason, {
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    });
    if (!updated) return undefined;
    return this.input.supervisorRuntime.reconcile(toReconcileInput(updated));
  }

  async steer(input: SubTaskSupervisorSteerInput): Promise<SubTaskSupervisorRuntimeItem | undefined> {
    requireCurrentSessionBinding(input.binding, "steer");
    const exact = await this.readExactRecord(input.binding);
    if (!exact) return undefined;
    if (!this.input.steerSubTask) {
      throw new Error("Subtask Supervisor steer controller is unavailable.");
    }
    const updated = await this.input.steerSubTask(exact.record.id, input.message, {
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    });
    if (!updated) return undefined;
    return this.input.supervisorRuntime.reconcile(toReconcileInput(updated));
  }

  dispose(): void {
    this.unsubscribe();
  }

  private reconcileEvent(event: SubTaskChangeEvent): void {
    if (!event.item.supervisorBinding) return;
    this.input.supervisorRuntime.reconcile(toReconcileInput(event.item));
  }

  private async readExactRecord(binding: SubTaskSupervisorExactBinding): Promise<{
    record: SubTaskRecord;
    observation: SubTaskSupervisorRuntimeItem;
  } | undefined> {
    const record = await this.input.runtimeStore.getTask(binding.taskId);
    if (!record?.supervisorBinding) return undefined;
    this.input.supervisorRuntime.reconcile(toReconcileInput(record));
    const observation = this.input.supervisorRuntime.observe(binding);
    return observation ? { record, observation } : undefined;
  }
}

function requireCurrentSessionBinding(
  binding: SubTaskSupervisorExactBinding,
  action: "cancel" | "steer",
): void {
  if (typeof binding.sessionId === "string" && binding.sessionId.trim()) return;
  throw new SubTaskSupervisorAdmissionError(
    "binding_conflict",
    `Subtask Supervisor ${action} requires the current child session binding.`,
  );
}

function toReconcileInput(record: SubTaskRecord) {
  if (!record.supervisorBinding) {
    throw new Error("Subtask does not have a Supervisor binding.");
  }
  return {
    binding: record.supervisorBinding,
    role: record.launchSpec.role,
    taskId: record.id,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    status: record.status,
    commandGeneration: record.commandGeneration,
    admittedAtMs: record.createdAt,
    updatedAtMs: record.updatedAt,
    ...(record.finishedAt === undefined ? {} : { finishedAtMs: record.finishedAt }),
  };
}
