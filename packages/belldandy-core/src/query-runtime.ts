import crypto from "node:crypto";

export type QueryRuntimeMethod =
  | "models.list"
  | "message.send"
  | "bridge.session.list"
  | "bridge.session.peek"
  | "conversation.run.stop"
  | "artifact.reveal"
  | "api.message"
  | "webhook.receive"
  | "tool_settings.confirm"
  | "external_outbound.confirm"
  | "email_outbound.confirm"
  | "email_followup.list"
  | "conversation.restore"
  | "conversation.transcript.export"
  | "conversation.timeline.get"
  | "conversation.prompt_snapshot.get"
  | "conversation.preflight_compression.retrieve"
  | "conversation.tool_result_reference.retrieve"
  | "conversation.digest.get"
  | "conversation.digest.refresh"
  | "conversation.memory.extraction.get"
  | "conversation.memory.extract"
  | "workspace.list"
  | "workspace.read"
  | "workspace.readSource"
  | "workspace.write"
  | "tools.list"
  | "tools.update"
  | "agent.catalog.get"
  | "agent.contracts.get"
  | "delegation.inspect.get"
  | "subtask.list"
  | "subtask.get"
  | "subtask.resume"
  | "subtask.takeover"
  | "subtask.update"
  | "subtask.stop"
  | "subtask.archive";

export type QueryRuntimeStage =
  | "started"
  | "auth_checked"
  | "request_validated"
  | "runtime_checked"
  | "restore_built"
  | "transcript_export_built"
  | "timeline_built"
  | "prompt_snapshot_loaded"
  | "preflight_sidecar_loaded"
  | "tool_reference_loaded"
  | "webhook_rule_loaded"
  | "idempotency_checked"
  | "agent_created"
  | "conversation_loaded"
  | "previous_run_stop_requested"
  | "user_message_persisted"
  | "digest_loaded"
  | "digest_refreshed"
  | "extraction_loaded"
  | "extraction_requested"
  | "workspace_target_resolved"
  | "workspace_listed"
  | "workspace_read"
  | "workspace_source_read"
  | "workspace_written"
  | "artifact_target_resolved"
  | "artifact_revealed"
  | "tool_inventory_loaded"
  | "tool_visibility_built"
  | "tool_settings_updated"
  | "tool_call_emitted"
  | "tool_result_emitted"
  | "tool_event_emitted"
  | "task_result_recorded"
  | "prompt_built"
  | "response_built"
  | "task_listed"
  | "task_loaded"
  | "task_output_loaded"
  | "task_prompt_snapshot_loaded"
  | "task_prompt_snapshot_missing"
  | "task_resumed"
  | "task_taken_over"
  | "task_updated"
  | "task_stopped"
  | "task_archived"
  | "runtime_report_built"
  | "agent_running"
  | "assistant_persisted"
  | "completed"
  | "failed";

export type QueryRuntimeStageEvent<TMethod extends QueryRuntimeMethod = QueryRuntimeMethod> = {
  traceId: string;
  method: TMethod;
  stage: QueryRuntimeStage;
  timestamp: number;
  conversationId?: string;
  detail?: Record<string, unknown>;
};

export type QueryRuntimeObserver<TMethod extends QueryRuntimeMethod = QueryRuntimeMethod> = (
  event: QueryRuntimeStageEvent<TMethod>,
) => void;

export class QueryRuntime<TMethod extends QueryRuntimeMethod> {
  private readonly method: TMethod;
  private readonly traceId: string;
  private readonly observer?: QueryRuntimeObserver<TMethod>;

  constructor(options: {
    method: TMethod;
    traceId?: string;
    observer?: QueryRuntimeObserver<TMethod>;
  }) {
    this.method = options.method;
    this.traceId = options.traceId ?? crypto.randomUUID();
    this.observer = options.observer;
  }

  mark(
    stage: QueryRuntimeStage,
    options: {
      conversationId?: string;
      detail?: Record<string, unknown>;
    } = {},
  ): void {
    this.observer?.({
      traceId: this.traceId,
      method: this.method,
      stage,
      timestamp: Date.now(),
      conversationId: options.conversationId,
      detail: options.detail,
    });
  }

  async run<T>(executor: (runtime: QueryRuntime<TMethod>) => Promise<T>): Promise<T> {
    this.mark("started");
    try {
      return await executor(this);
    } catch (error) {
      this.mark("failed", {
        detail: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}
