import type { AgentRegistry } from "@belldandy/agent";
import type { GatewayEventFrame, GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import type { PluginRegistry } from "@belldandy/plugins";
import type {
  SkillRegistry,
  ToolContractChannel,
  ToolExecutor,
  WorkflowRuntimeCapabilities,
} from "@belldandy/skills";

import type { ExternalOutboundAuditStore } from "../external-outbound-audit-store.js";
import type { ExternalOutboundConfirmationStore } from "../external-outbound-confirmation-store.js";
import type { ExternalOutboundSenderRegistry } from "../external-outbound-sender-registry.js";
import type { EmailOutboundAuditStore } from "../email-outbound-audit-store.js";
import type { EmailOutboundConfirmationStore } from "../email-outbound-confirmation-store.js";
import type { EmailOutboundProviderRegistry } from "../email-outbound-provider-registry.js";
import type { EmailInboundAuditStore } from "../email-inbound-audit-store.js";
import type { EmailFollowUpReminderStore } from "../email-follow-up-reminder-store.js";
import {
  createFileEmailOutboundAuditStore,
  resolveEmailOutboundAuditStorePath,
} from "../email-outbound-audit-store.js";
import {
  createFileEmailInboundAuditStore,
  resolveEmailInboundAuditStorePath,
} from "../email-inbound-audit-store.js";
import {
  createFileEmailFollowUpReminderStore,
  resolveEmailFollowUpReminderStorePath,
} from "../email-follow-up-reminder-store.js";
import {
  createFileExternalOutboundAuditStore,
  resolveExternalOutboundAuditStorePath,
} from "../external-outbound-audit-store.js";
import type { ExtensionHostState } from "../extension-host.js";
import { handleAgentCatalogGetWithQueryRuntime } from "../query-runtime-agent-catalog.js";
import { handleAgentContractsGetWithQueryRuntime } from "../query-runtime-agent-contracts.js";
import { handleDelegationInspectGetWithQueryRuntime } from "../query-runtime-delegation.js";
import { handleExternalOutboundConfirmWithQueryRuntime } from "../query-runtime-external-outbound.js";
import { handleEmailOutboundConfirmWithQueryRuntime } from "../query-runtime-email-outbound.js";
import type { ConversationPromptSnapshotArtifact } from "../conversation-prompt-snapshot.js";
import type { QueryRuntimeTraceStore } from "../query-runtime-trace.js";
import {
  handleSubTaskArchiveWithQueryRuntime,
  handleSubTaskGetWithQueryRuntime,
  handleSubTaskListWithQueryRuntime,
  handleSubTaskResumeWithQueryRuntime,
  handleSubTaskStopWithQueryRuntime,
  handleSubTaskTakeoverWithQueryRuntime,
  handleSubTaskUpdateWithQueryRuntime,
} from "../query-runtime-subtask.js";
import {
  handleBridgeSessionListWithQueryRuntime,
  handleBridgeSessionPeekWithQueryRuntime,
} from "../query-runtime-bridge.js";
import {
  handleToolSettingsConfirmWithQueryRuntime,
  handleToolsListWithQueryRuntime,
  handleToolsUpdateWithQueryRuntime,
  type QueryRuntimeToolsContext,
} from "../query-runtime-tools.js";
import type { ResidentAgentRuntimeRegistry } from "../resident-agent-runtime.js";
import type {
  SubTaskCommandRequestOptions,
  SubTaskRecord,
  SubTaskRuntimeStore,
} from "../task-runtime.js";
import type { ToolControlConfirmationStore } from "../tool-control-confirmation-store.js";
import type { ToolsConfigManager } from "../tools-config.js";

type ToolSettingsConfirmParseResult =
  | { ok: true; value: any }
  | { ok: false; message: string };

type QueryRuntimeDomainsMethodContext = {
  clientId: string;
  requestChannel?: ToolContractChannel;
  stateDir: string;
  agentRegistry?: AgentRegistry;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  queryRuntimeTraceStore: QueryRuntimeTraceStore;
  toolExecutor?: ToolExecutor;
  toolsConfigManager?: ToolsConfigManager;
  toolControlConfirmationStore?: ToolControlConfirmationStore;
  getAgentToolControlMode?: () => "disabled" | "confirm" | "auto";
  getAgentToolControlConfirmPassword?: () => string | undefined;
  pluginRegistry?: PluginRegistry;
  extensionHost?: Pick<ExtensionHostState, "lifecycle">;
  skillRegistry?: SkillRegistry;
  subTaskRuntimeStore?: SubTaskRuntimeStore;
  workflowRuntime?: WorkflowRuntimeCapabilities;
  getConversationPromptSnapshot?: (input: {
    conversationId: string;
    runId?: string;
  }) => Promise<ConversationPromptSnapshotArtifact | undefined>;
  resumeSubTask?: (
    taskId: string,
    message?: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  takeoverSubTask?: (
    taskId: string,
    agentId: string,
    message?: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  updateSubTask?: (
    taskId: string,
    message: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  stopSubTask?: (
    taskId: string,
    reason?: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  externalOutboundConfirmationStore?: ExternalOutboundConfirmationStore;
  externalOutboundSenderRegistry?: ExternalOutboundSenderRegistry;
  externalOutboundAuditStore?: ExternalOutboundAuditStore;
  emailOutboundConfirmationStore?: EmailOutboundConfirmationStore;
  emailOutboundProviderRegistry?: EmailOutboundProviderRegistry;
  emailOutboundAuditStore?: EmailOutboundAuditStore;
  emailInboundAuditStore?: EmailInboundAuditStore;
  emailFollowUpReminderStore?: EmailFollowUpReminderStore;
  emitEvent: NonNullable<QueryRuntimeToolsContext["emitEvent"]>;
  parseToolSettingsConfirmParams: (value: unknown) => ToolSettingsConfirmParseResult;
  parseExternalOutboundConfirmParams: (value: unknown) => ToolSettingsConfirmParseResult;
  parseEmailOutboundConfirmParams: (value: unknown) => ToolSettingsConfirmParseResult;
  resolvePendingToolControlRequest: NonNullable<QueryRuntimeToolsContext["resolvePendingToolControlRequest"]>;
  applyToolControlChanges: NonNullable<QueryRuntimeToolsContext["applyToolControlChanges"]>;
  buildToolControlDisabledPayload: NonNullable<QueryRuntimeToolsContext["buildToolControlDisabledPayload"]>;
  resolveToolControlPolicySnapshot: QueryRuntimeToolsContext["resolveToolControlPolicySnapshot"];
  summarizeGroupedVisibility: QueryRuntimeToolsContext["summarizeGroupedVisibility"];
};

type ToolsRuntimeMethod = "tools.list" | "tools.update" | "tool_settings.confirm";
type SubTaskRuntimeMethod =
  | "subtask.list"
  | "subtask.get"
  | "subtask.resume"
  | "subtask.takeover"
  | "subtask.update"
  | "subtask.stop"
  | "subtask.archive";
type BridgeRuntimeMethod =
  | "bridge.session.list"
  | "bridge.session.peek";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseExpectedRevision(value: unknown):
  | { ok: true; value?: number }
  | { ok: false } {
  if (value === undefined) return { ok: true };
  if (!Number.isInteger(value) || Number(value) < 0) return { ok: false };
  return { ok: true, value: Number(value) };
}

function createToolsRuntimeContext(requestId: string, ctx: QueryRuntimeDomainsMethodContext) {
  return {
    requestId,
    clientId: ctx.clientId,
    requestChannel: ctx.requestChannel,
    toolExecutor: ctx.toolExecutor,
    toolsConfigManager: ctx.toolsConfigManager,
    toolControlConfirmationStore: ctx.toolControlConfirmationStore,
    getAgentToolControlMode: ctx.getAgentToolControlMode,
    getAgentToolControlConfirmPassword: ctx.getAgentToolControlConfirmPassword,
    agentRegistry: ctx.agentRegistry,
    pluginRegistry: ctx.pluginRegistry,
    stateDir: ctx.stateDir,
    extensionHost: ctx.extensionHost,
    skillRegistry: ctx.skillRegistry,
    subTaskRuntimeStore: ctx.subTaskRuntimeStore,
    workflowRuntime: ctx.workflowRuntime,
    resolvePendingToolControlRequest: ctx.resolvePendingToolControlRequest,
    applyToolControlChanges: ctx.applyToolControlChanges,
    buildToolControlDisabledPayload: ctx.buildToolControlDisabledPayload,
    emitEvent: ctx.emitEvent,
    resolveToolControlPolicySnapshot: ctx.resolveToolControlPolicySnapshot,
    summarizeGroupedVisibility: ctx.summarizeGroupedVisibility,
    runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<ToolsRuntimeMethod>(),
  };
}

function createSubTaskRuntimeContext(requestId: string, ctx: QueryRuntimeDomainsMethodContext) {
  return {
    requestId,
    stateDir: ctx.stateDir,
    subTaskRuntimeStore: ctx.subTaskRuntimeStore,
    agentRegistry: ctx.agentRegistry,
    loadPromptSnapshot: ctx.getConversationPromptSnapshot,
    resumeSubTask: ctx.resumeSubTask,
    takeoverSubTask: ctx.takeoverSubTask,
    updateSubTask: ctx.updateSubTask,
    stopSubTask: ctx.stopSubTask,
    runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<SubTaskRuntimeMethod>(),
  };
}

function createBridgeRuntimeContext(requestId: string, ctx: QueryRuntimeDomainsMethodContext) {
  return {
    requestId,
    stateDir: ctx.stateDir,
    runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<BridgeRuntimeMethod>(),
  };
}

export async function handleQueryRuntimeDomainsMethod(
  req: GatewayReqFrame,
  ctx: QueryRuntimeDomainsMethodContext,
): Promise<GatewayResFrame | null> {
  switch (req.method) {
    case "tool_settings.confirm": {
      const parsed = ctx.parseToolSettingsConfirmParams(req.params);
      if (!parsed.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
      }
      return handleToolSettingsConfirmWithQueryRuntime(
        createToolsRuntimeContext(req.id, ctx),
        parsed.value,
      );
    }

    case "external_outbound.confirm": {
      const parsed = ctx.parseExternalOutboundConfirmParams(req.params);
      if (!parsed.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
      }
      return handleExternalOutboundConfirmWithQueryRuntime({
        requestId: req.id,
        clientId: ctx.clientId,
        confirmationStore: ctx.externalOutboundConfirmationStore,
        senderRegistry: ctx.externalOutboundSenderRegistry,
        auditStore: ctx.externalOutboundAuditStore,
        emitEvent: ctx.emitEvent,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"external_outbound.confirm">(),
      }, parsed.value);
    }

    case "external_outbound.audit.list": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 20;
      const auditStore = ctx.externalOutboundAuditStore
        ?? createFileExternalOutboundAuditStore(resolveExternalOutboundAuditStorePath(ctx.stateDir));
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: {
          items: await auditStore.listRecent(limit),
          limit,
        },
      };
    }

    case "email_outbound.confirm": {
      const parsed = ctx.parseEmailOutboundConfirmParams(req.params);
      if (!parsed.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
      }
      return handleEmailOutboundConfirmWithQueryRuntime({
        requestId: req.id,
        clientId: ctx.clientId,
        confirmationStore: ctx.emailOutboundConfirmationStore,
        providerRegistry: ctx.emailOutboundProviderRegistry,
        auditStore: ctx.emailOutboundAuditStore,
        reminderStore: ctx.emailFollowUpReminderStore,
        emitEvent: ctx.emitEvent,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"email_outbound.confirm">(),
      }, parsed.value);
    }

    case "email_outbound.audit.list": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 20;
      const auditStore = ctx.emailOutboundAuditStore
        ?? createFileEmailOutboundAuditStore(resolveEmailOutboundAuditStorePath(ctx.stateDir));
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: {
          items: await auditStore.listRecent(limit),
          limit,
        },
      };
    }

    case "email_inbound.audit.list": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 20;
      const auditStore = ctx.emailInboundAuditStore
        ?? createFileEmailInboundAuditStore(resolveEmailInboundAuditStorePath(ctx.stateDir));
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: {
          items: await auditStore.listRecent(limit),
          limit,
        },
      };
    }

    case "email_followup.list": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 20;
      const reminderStore = ctx.emailFollowUpReminderStore
        ?? createFileEmailFollowUpReminderStore(resolveEmailFollowUpReminderStorePath(ctx.stateDir));
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: {
          items: await reminderStore.listRecent(limit),
          limit,
        },
      };
    }

    case "tools.list": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const requestedTaskId = typeof params.taskId === "string" && params.taskId.trim()
        ? params.taskId.trim()
        : undefined;
      const visibilityAgentId = typeof params.agentId === "string" && params.agentId.trim()
        ? params.agentId.trim()
        : undefined;
      const visibilityConversationId = typeof params.conversationId === "string" && params.conversationId.trim()
        ? params.conversationId.trim()
        : undefined;
      return handleToolsListWithQueryRuntime(createToolsRuntimeContext(req.id, ctx), {
        taskId: requestedTaskId,
        agentId: visibilityAgentId,
        conversationId: visibilityConversationId,
      });
    }

    case "tools.update": {
      const params = req.params as unknown as { disabled?: { builtin?: string[]; mcp_servers?: string[]; plugins?: string[] } } | undefined;
      if (!params?.disabled) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "Missing disabled" } };
      }
      return handleToolsUpdateWithQueryRuntime(createToolsRuntimeContext(req.id, ctx), {
        disabled: params.disabled,
      });
    }

    case "agent.catalog.get": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const agentId = typeof params.agentId === "string" && params.agentId.trim()
        ? params.agentId.trim()
        : undefined;
      return handleAgentCatalogGetWithQueryRuntime({
        requestId: req.id,
        stateDir: ctx.stateDir,
        agentRegistry: ctx.agentRegistry,
        residentAgentRuntime: ctx.residentAgentRuntime,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"agent.catalog.get">(),
      }, {
        agentId,
      });
    }

    case "agent.contracts.get": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const requestedTaskId = typeof params.taskId === "string" && params.taskId.trim()
        ? params.taskId.trim()
        : undefined;
      const visibilityAgentId = typeof params.agentId === "string" && params.agentId.trim()
        ? params.agentId.trim()
        : undefined;
      const visibilityConversationId = typeof params.conversationId === "string" && params.conversationId.trim()
        ? params.conversationId.trim()
        : undefined;
      return handleAgentContractsGetWithQueryRuntime({
        requestId: req.id,
        requestChannel: ctx.requestChannel,
        toolExecutor: ctx.toolExecutor,
        subTaskRuntimeStore: ctx.subTaskRuntimeStore,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"agent.contracts.get">(),
      }, {
        taskId: requestedTaskId,
        agentId: visibilityAgentId,
        conversationId: visibilityConversationId,
      });
    }

    case "delegation.inspect.get": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const taskId = typeof params.taskId === "string" && params.taskId.trim()
        ? params.taskId.trim()
        : "";
      if (!taskId) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "invalid_params", message: "taskId is required" },
        };
      }
      return handleDelegationInspectGetWithQueryRuntime({
        requestId: req.id,
        subTaskRuntimeStore: ctx.subTaskRuntimeStore,
        agentRegistry: ctx.agentRegistry,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"delegation.inspect.get">(),
      }, {
        taskId,
      });
    }

    case "subtask.list": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const conversationId = typeof params.conversationId === "string" && params.conversationId.trim()
        ? params.conversationId.trim()
        : undefined;
      const includeArchived = params.includeArchived === true;
      const paginationRequested = params.limit !== undefined || params.cursor !== undefined;
      const limit = params.limit;
      const cursor = typeof params.cursor === "string" ? params.cursor.trim() : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 200)) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "limit must be an integer between 1 and 200" } };
      }
      if (params.cursor !== undefined && !cursor) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "cursor must be a non-empty string" } };
      }
      return handleSubTaskListWithQueryRuntime(createSubTaskRuntimeContext(req.id, ctx), {
        conversationId,
        includeArchived,
        ...(paginationRequested ? {
          limit: limit === undefined ? undefined : Number(limit),
          cursor,
        } : {}),
      });
    }

    case "subtask.get": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
      if (!taskId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "taskId is required" } };
      }
      return handleSubTaskGetWithQueryRuntime(createSubTaskRuntimeContext(req.id, ctx), {
        taskId,
      });
    }

    case "subtask.resume": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
      const message = typeof params.message === "string" && params.message.trim()
        ? params.message.trim()
        : undefined;
      const expectedRevision = parseExpectedRevision(params.expectedRevision);
      if (!taskId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "taskId is required" } };
      }
      if (!expectedRevision.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "expectedRevision must be a non-negative integer" } };
      }
      return handleSubTaskResumeWithQueryRuntime(createSubTaskRuntimeContext(req.id, ctx), {
        taskId,
        message,
        expectedRevision: expectedRevision.value,
      });
    }

    case "subtask.takeover": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
      const message = typeof params.message === "string" && params.message.trim()
        ? params.message.trim()
        : undefined;
      const expectedRevision = parseExpectedRevision(params.expectedRevision);
      if (!taskId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "taskId is required" } };
      }
      if (!agentId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "agentId is required" } };
      }
      if (!expectedRevision.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "expectedRevision must be a non-negative integer" } };
      }
      return handleSubTaskTakeoverWithQueryRuntime(createSubTaskRuntimeContext(req.id, ctx), {
        taskId,
        agentId,
        message,
        expectedRevision: expectedRevision.value,
      });
    }

    case "subtask.update": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
      const message = typeof params.message === "string" ? params.message.trim() : "";
      const expectedRevision = parseExpectedRevision(params.expectedRevision);
      if (!taskId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "taskId is required" } };
      }
      if (!message) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "message is required" } };
      }
      if (!expectedRevision.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "expectedRevision must be a non-negative integer" } };
      }
      return handleSubTaskUpdateWithQueryRuntime(createSubTaskRuntimeContext(req.id, ctx), {
        taskId,
        message,
        expectedRevision: expectedRevision.value,
      });
    }

    case "subtask.stop": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
      const reason = typeof params.reason === "string" && params.reason.trim()
        ? params.reason.trim()
        : undefined;
      const expectedRevision = parseExpectedRevision(params.expectedRevision);
      if (!taskId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "taskId is required" } };
      }
      if (!expectedRevision.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "expectedRevision must be a non-negative integer" } };
      }
      return handleSubTaskStopWithQueryRuntime(createSubTaskRuntimeContext(req.id, ctx), {
        taskId,
        reason,
        expectedRevision: expectedRevision.value,
      });
    }

    case "subtask.archive": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
      const reason = typeof params.reason === "string" && params.reason.trim()
        ? params.reason.trim()
        : undefined;
      if (!taskId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "taskId is required" } };
      }
      return handleSubTaskArchiveWithQueryRuntime(createSubTaskRuntimeContext(req.id, ctx), {
        taskId,
        reason,
      });
    }

    case "bridge.session.list": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const status = params.status === "active" || params.status === "closed"
        ? params.status
        : undefined;
      const targetId = typeof params.targetId === "string" && params.targetId.trim()
        ? params.targetId.trim()
        : undefined;
      const taskId = typeof params.taskId === "string" && params.taskId.trim()
        ? params.taskId.trim()
        : undefined;
      return handleBridgeSessionListWithQueryRuntime(createBridgeRuntimeContext(req.id, ctx), {
        status,
        targetId,
        taskId,
      });
    }

    case "bridge.session.peek": {
      const params = isObjectRecord(req.params) ? req.params : {};
      const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
      const transcriptLimit = typeof params.transcriptLimit === "number" && Number.isFinite(params.transcriptLimit)
        ? params.transcriptLimit
        : undefined;
      if (!sessionId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "sessionId is required" } };
      }
      return handleBridgeSessionPeekWithQueryRuntime(createBridgeRuntimeContext(req.id, ctx), {
        sessionId,
        transcriptLimit,
      });
    }

    default:
      return null;
  }
}
