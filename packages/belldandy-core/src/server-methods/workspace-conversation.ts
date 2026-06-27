import type fs from "node:fs";

import type {
  AgentRegistry,
  CompactionRuntimeReport,
  Conversation,
  ConversationMessage,
  ConversationStore,
} from "@belldandy/agent";
import { estimateMessagesTokens } from "@belldandy/agent";
import type {
  ConversationMetaMessage,
  GatewayEventFrame,
  GatewayReqFrame,
  GatewayResFrame,
} from "@belldandy/protocol";
import type {
  DurableExtractionDigestSnapshot,
  DurableExtractionRecord,
  DurableExtractionRuntime,
} from "@belldandy/memory";
import {
  createTaskWorkSurface,
  getGlobalMemoryManager,
} from "@belldandy/memory";

import { buildConversationContinuationState } from "../continuation-state.js";
import { estimateCarryoverContextPreludeTokens } from "../context-injection.js";
import type { ConversationPromptSnapshotArtifact } from "../conversation-prompt-snapshot.js";
import { buildGoalSessionStartBanner } from "../goal-session-banner.js";
import type {
  MemoryRuntimeBudgetGuard,
  MemoryRuntimeUsageAccounting,
  SlidingWindowRateLimiter,
} from "../memory-runtime-budget.js";
import { buildMemoryRuntimeDoctorReport } from "../memory-runtime-introspection.js";
import {
  handleConversationDigestGetWithQueryRuntime,
  handleConversationDigestRefreshWithQueryRuntime,
  handleConversationMemoryExtractionGetWithQueryRuntime,
  handleConversationMemoryExtractWithQueryRuntime,
  handleConversationRestoreWithQueryRuntime,
  handleConversationTimelineGetWithQueryRuntime,
  handleConversationTranscriptExportWithQueryRuntime,
} from "../query-runtime-memory.js";
import { handleConversationPromptSnapshotGetWithQueryRuntime } from "../query-runtime-prompt-snapshot.js";
import type { QueryRuntimeTraceStore } from "../query-runtime-trace.js";
import {
  handleWorkspaceListWithQueryRuntime,
  handleWorkspaceReadSourceWithQueryRuntime,
  handleWorkspaceReadWithQueryRuntime,
  handleWorkspaceWriteWithQueryRuntime,
} from "../query-runtime-workspace.js";
import { handleArtifactRevealWithQueryRuntime } from "../query-runtime-artifact.js";
import type { GoalManager } from "../goals/manager.js";

type WorkspaceConversationMethodContext = {
  stateDir: string;
  generatedDir: string;
  additionalWorkspaceRoots: string[];
  conversationStore: ConversationStore;
  getConversationPromptSnapshot?: (input: {
    conversationId: string;
    runId?: string;
  }) => Promise<ConversationPromptSnapshotArtifact | undefined>;
  agentRegistry?: AgentRegistry;
  durableExtractionRuntime?: DurableExtractionRuntime;
  requestDurableExtraction?: (input: {
    conversationId: string;
    source: string;
    digest: DurableExtractionDigestSnapshot;
  }) => Promise<DurableExtractionRecord | undefined>;
  memoryUsageAccounting: MemoryRuntimeUsageAccounting;
  memoryBudgetGuard: MemoryRuntimeBudgetGuard;
  durableExtractionRequestRateLimiter: SlidingWindowRateLimiter;
  broadcastEvent?: (frame: GatewayEventFrame) => void;
  getCompactionRuntimeReport?: () => CompactionRuntimeReport | undefined;
  queryRuntimeTraceStore: QueryRuntimeTraceStore;
  statIfExists: (targetPath: string) => Promise<fs.Stats | null>;
  isUnderRoot: (root: string, target: string) => boolean;
  writeTextFileAtomic: (
    filePath: string,
    content: string,
    options?: { ensureParent?: boolean; mode?: number },
  ) => Promise<void>;
  guardTeamSharedMemoryWrite?: (input: {
    stateDir: string;
    relativePath: string;
    content: string;
  }) => {
    applies: boolean;
    ok: boolean;
    code?: string;
    message?: string;
  };
  goalManager?: GoalManager;
  buildDurableExtractionUnavailableError: (runtime?: DurableExtractionRuntime) => { code: string; message: string };
  refreshConversationDigestAndBroadcast: (
    conversationStore: ConversationStore,
    payload: {
      conversationId: string;
      force?: boolean;
      threshold?: number;
      source: string;
    },
    broadcastEvent?: (frame: GatewayEventFrame) => void,
    durableExtractionRuntime?: DurableExtractionRuntime,
    requestDurableExtraction?: (input: {
      conversationId: string;
      source: string;
      digest: DurableExtractionDigestSnapshot;
    }) => Promise<DurableExtractionRecord | undefined>,
    memoryUsageAccounting?: MemoryRuntimeUsageAccounting,
    memoryBudgetGuard?: MemoryRuntimeBudgetGuard,
  ) => Promise<unknown>;
  toDurableExtractionDigestSnapshot: (
    digest: Awaited<ReturnType<ConversationStore["getSessionDigest"]>>,
  ) => DurableExtractionDigestSnapshot;
  isMemoryBudgetExceededError: (error: unknown) => error is Error & {
    decision: {
      reasonCode?: string;
      reasonMessage?: string;
    };
  };
};

type WorkspaceMethod =
  | "artifact.reveal"
  | "workspace.list"
  | "workspace.read"
  | "workspace.readSource"
  | "workspace.write";

type ConversationMethod =
  | "conversation.restore"
  | "conversation.transcript.export"
  | "conversation.timeline.get"
  | "conversation.digest.get"
  | "conversation.digest.refresh"
  | "conversation.memory.extraction.get"
  | "conversation.memory.extract";

function createWorkspaceRuntimeContext(
  requestId: string,
  ctx: WorkspaceConversationMethodContext,
) {
  return {
    requestId,
    stateDir: ctx.stateDir,
    additionalWorkspaceRoots: ctx.additionalWorkspaceRoots,
    statIfExists: ctx.statIfExists,
    isUnderRoot: ctx.isUnderRoot,
    writeTextFileAtomic: ctx.writeTextFileAtomic,
    guardTeamSharedMemoryWrite: ctx.guardTeamSharedMemoryWrite,
    runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<WorkspaceMethod>(),
  };
}

function createConversationRuntimeContext(
  requestId: string,
  ctx: WorkspaceConversationMethodContext,
) {
  return {
    requestId,
    conversationStore: ctx.conversationStore,
    durableExtractionRuntime: ctx.durableExtractionRuntime,
    stateDir: ctx.stateDir,
    teamSharedMemoryEnabled: process.env.BELLDANDY_TEAM_SHARED_MEMORY_ENABLED === "true",
    requestDurableExtraction: ctx.requestDurableExtraction,
    memoryUsageAccounting: ctx.memoryUsageAccounting,
    memoryBudgetGuard: ctx.memoryBudgetGuard,
    durableExtractionRequestRateLimiter: ctx.durableExtractionRequestRateLimiter,
    broadcastEvent: ctx.broadcastEvent,
    buildMemoryRuntimeDoctorReport: (input: Parameters<typeof buildMemoryRuntimeDoctorReport>[0]) => buildMemoryRuntimeDoctorReport({
      ...input,
      compactionRuntimeReport: ctx.getCompactionRuntimeReport?.(),
    }),
    buildDurableExtractionUnavailableError: ctx.buildDurableExtractionUnavailableError,
    refreshConversationDigestAndBroadcast: ctx.refreshConversationDigestAndBroadcast,
    toDurableExtractionDigestSnapshot: ctx.toDurableExtractionDigestSnapshot,
    isMemoryBudgetExceededError: ctx.isMemoryBudgetExceededError,
    runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<ConversationMethod>(),
  };
}

function isCarryoverContextEnabled(): boolean {
  return process.env.BELLDANDY_CARRYOVER_CONTEXT_ENABLED !== "false";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalMessageTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const hours = Math.floor(absOffset / 60);
  const minutes = absOffset % 60;
  const offsetText = minutes > 0 ? `GMT${sign}${hours}:${pad2(minutes)}` : `GMT${sign}${hours}`;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${offsetText}`;
}

function normalizeConversationMessage(message: ConversationMessage, isLatest: boolean): ConversationMetaMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestampMs: message.timestamp,
    displayTimeText: formatLocalMessageTime(message.timestamp),
    isLatest,
    agentId: message.agentId,
    clientContext: message.clientContext,
  };
}

function buildConversationMetaMessages(conversation?: Conversation): ConversationMetaMessage[] {
  if (!conversation?.messages?.length) return [];
  return conversation.messages.map((message, index) => normalizeConversationMessage(message, index === conversation.messages.length - 1));
}

export async function handleWorkspaceConversationMethod(
  req: GatewayReqFrame,
  ctx: WorkspaceConversationMethodContext,
): Promise<GatewayResFrame | null> {
  switch (req.method) {
    case "artifact.reveal": {
      const params = req.params as { path?: string } | undefined;
      const artifactPath = params?.path;

      if (!artifactPath || typeof artifactPath !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "path is required" } };
      }
      return handleArtifactRevealWithQueryRuntime({
        requestId: req.id,
        generatedDir: ctx.generatedDir,
        isUnderRoot: ctx.isUnderRoot,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"artifact.reveal">(),
      }, {
        path: artifactPath,
      });
    }

    case "workspace.list": {
      const params = req.params as { path?: string } | undefined;
      return handleWorkspaceListWithQueryRuntime(createWorkspaceRuntimeContext(req.id, ctx), {
        path: params?.path,
      });
    }

    case "workspace.read": {
      const params = req.params as { path?: string } | undefined;
      const relativePath = params?.path;

      if (!relativePath || typeof relativePath !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "path is required" } };
      }
      return handleWorkspaceReadWithQueryRuntime(createWorkspaceRuntimeContext(req.id, ctx), {
        path: relativePath,
      });
    }

    case "workspace.readSource": {
      const params = req.params as { path?: string } | undefined;
      const requestedPath = params?.path;

      if (!requestedPath || typeof requestedPath !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "path is required" } };
      }
      return handleWorkspaceReadSourceWithQueryRuntime(createWorkspaceRuntimeContext(req.id, ctx), {
        path: requestedPath,
      });
    }

    case "workspace.write": {
      const params = req.params as { path?: string; content?: string } | undefined;
      const relativePath = params?.path;
      const content = params?.content;

      if (!relativePath || typeof relativePath !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "path is required" } };
      }
      if (typeof content !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "content is required" } };
      }
      return handleWorkspaceWriteWithQueryRuntime(createWorkspaceRuntimeContext(req.id, ctx), {
        path: relativePath,
        content,
      });
    }

    case "context.compact": {
      const params = req.params as { conversationId?: string } | undefined;
      const conversationId = params?.conversationId;

      if (!conversationId || typeof conversationId !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      try {
        const result = await ctx.conversationStore.forceCompact(conversationId);
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: {
            compacted: result.compacted,
            originalTokens: result.originalTokens,
            compactedTokens: result.compactedTokens,
            tier: result.tier,
            boundary: result.boundary,
          },
        };
      } catch (error) {
        return { type: "res", id: req.id, ok: false, error: { code: "compact_failed", message: String(error) } };
      }
    }

    case "context.compact.partial": {
      const params = req.params as {
        conversationId?: string;
        direction?: string;
        pivotMessageId?: string;
        pivotIndex?: number;
      } | undefined;
      const conversationId = params?.conversationId;
      const direction = params?.direction;

      if (!conversationId || typeof conversationId !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }
      if (direction !== "up_to" && direction !== "from") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "direction must be 'up_to' or 'from'" } };
      }

      try {
        const result = await ctx.conversationStore.forcePartialCompact(conversationId, {
          direction,
          pivotMessageId: typeof params?.pivotMessageId === "string" ? params.pivotMessageId : undefined,
          pivotIndex: typeof params?.pivotIndex === "number" && Number.isFinite(params.pivotIndex)
            ? params.pivotIndex
            : undefined,
        });
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: {
            compacted: result.compacted,
            direction: result.direction,
            originalTokens: result.originalTokens,
            compactedTokens: result.compactedTokens,
            tier: result.tier,
            boundary: result.boundary,
          },
        };
      } catch (error) {
        return { type: "res", id: req.id, ok: false, error: { code: "compact_failed", message: String(error) } };
      }
    }

    case "conversation.meta": {
      const params = req.params as { conversationId?: string; limit?: number } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const limit = typeof params?.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(50, Math.floor(params.limit)))
        : 10;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      const conversation = ctx.conversationStore.get(conversationId);
      const messages = buildConversationMetaMessages(conversation);
      const taskTokenResults = ctx.conversationStore.getTaskTokenResults(conversationId, limit);
      const loadedDeferredTools = ctx.conversationStore.getLoadedToolNames(conversationId);
      const planState = ctx.conversationStore.getPlanState?.(conversationId) ?? null;
      const compactBoundaries = ctx.conversationStore.getCompactBoundaries(conversationId, limit);
      const carryoverContext = isCarryoverContextEnabled() && typeof (ctx.conversationStore as ConversationStore & {
        getCarryoverContext?: (conversationId: string, options?: { limit?: number }) => Array<{ tokenEstimate?: number }>;
      }).getCarryoverContext === "function"
        ? (ctx.conversationStore as ConversationStore & {
          getCarryoverContext: (conversationId: string, options?: { limit?: number }) => Array<{ tokenEstimate?: number }>;
        }).getCarryoverContext(conversationId, { limit: 6 })
        : [];
      const retainedContext = await ctx.conversationStore.getConversationHistoryCompacted(conversationId);
      const digest = await ctx.conversationStore.getSessionDigest(conversationId);
      const sessionMemory = await ctx.conversationStore.getSessionMemory(conversationId);
      const memoryManager = getGlobalMemoryManager({ conversationId });
      const resumeItem = memoryManager
        ? createTaskWorkSurface(memoryManager).resumeContext({ conversationId })
        : null;
      const goalSessionEntryBanner = ctx.goalManager
        ? await buildGoalSessionStartBanner({
          sessionKey: conversationId,
          getGoal: (goalId) => ctx.goalManager!.getGoal(goalId),
          getHandoff: (goalId) => ctx.goalManager!.getHandoff(goalId),
          readTaskGraph: (goalId) => ctx.goalManager!.readTaskGraph(goalId),
        }).catch(() => undefined)
        : undefined;
      const retainedTokens = retainedContext.history.length > 0 ? estimateMessagesTokens(retainedContext.history) : 0;
      const carryoverTokens = estimateCarryoverContextPreludeTokens(carryoverContext);
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: {
          conversationId,
          messages,
          taskTokenResults,
          loadedDeferredTools,
          planState,
          compactBoundaries,
          retainedContextEstimate: {
            tokens: retainedTokens,
            messageCount: retainedContext.history.length,
            compacted: retainedContext.compacted,
            ...(retainedContext.boundary ? { boundary: retainedContext.boundary } : {}),
          },
          carryoverContextEstimate: {
            tokens: carryoverTokens,
            itemCount: carryoverContext.length,
          },
          nextTurnContextEstimate: {
            tokens: retainedTokens + carryoverTokens,
            retainedTokens,
            carryoverTokens,
          },
          continuationState: buildConversationContinuationState({
            conversationId,
            messages,
            taskTokenResults,
            loadedDeferredTools,
            compactBoundaries,
            sessionDigest: digest,
            sessionMemory,
            resumeContext: resumeItem?.resumeContext,
          }),
          goalSessionEntryBanner,
        },
      };
    }

    case "conversation.transcript.export": {
      const params = req.params as {
        conversationId?: string;
        mode?: "internal" | "shareable" | "metadata_only";
      } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const mode = params?.mode;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }
      if (mode !== undefined && mode !== "internal" && mode !== "shareable" && mode !== "metadata_only") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "mode must be internal, shareable, or metadata_only" } };
      }

      return handleConversationTranscriptExportWithQueryRuntime(
        createConversationRuntimeContext(req.id, ctx),
        { conversationId, mode },
      );
    }

    case "conversation.timeline.get": {
      const params = req.params as {
        conversationId?: string;
        previewChars?: number;
      } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const previewChars = typeof params?.previewChars === "number" && Number.isFinite(params.previewChars)
        ? Math.max(24, Math.floor(params.previewChars))
        : undefined;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      return handleConversationTimelineGetWithQueryRuntime(
        createConversationRuntimeContext(req.id, ctx),
        { conversationId, previewChars },
      );
    }

    case "conversation.prompt_snapshot.get": {
      const params = req.params as {
        conversationId?: string;
        runId?: string;
      } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const runId = typeof params?.runId === "string" && params.runId.trim()
        ? params.runId.trim()
        : undefined;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }
      if (!ctx.getConversationPromptSnapshot) {
        return { type: "res", id: req.id, ok: false, error: { code: "not_available", message: "Prompt snapshot artifacts are not available." } };
      }

      return handleConversationPromptSnapshotGetWithQueryRuntime({
        requestId: req.id,
        stateDir: ctx.stateDir,
        agentRegistry: ctx.agentRegistry,
        loadPromptSnapshot: ctx.getConversationPromptSnapshot,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"conversation.prompt_snapshot.get">(),
      }, {
        conversationId,
        runId,
      });
    }

    case "conversation.digest.get": {
      const params = req.params as { conversationId?: string; threshold?: number } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const threshold = typeof params?.threshold === "number" && Number.isFinite(params.threshold)
        ? Math.max(1, Math.floor(params.threshold))
        : undefined;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      return handleConversationDigestGetWithQueryRuntime(
        createConversationRuntimeContext(req.id, ctx),
        { conversationId, threshold },
      );
    }

    case "conversation.digest.refresh": {
      const params = req.params as { conversationId?: string; force?: boolean; threshold?: number } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const threshold = typeof params?.threshold === "number" && Number.isFinite(params.threshold)
        ? Math.max(1, Math.floor(params.threshold))
        : undefined;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      return handleConversationDigestRefreshWithQueryRuntime(
        createConversationRuntimeContext(req.id, ctx),
        {
          conversationId,
          threshold,
          force: params?.force === true,
        },
      );
    }

    case "conversation.memory.extraction.get": {
      const params = req.params as { conversationId?: string; threshold?: number } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const threshold = typeof params?.threshold === "number" && Number.isFinite(params.threshold)
        ? Math.max(1, Math.floor(params.threshold))
        : undefined;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      return handleConversationMemoryExtractionGetWithQueryRuntime(
        createConversationRuntimeContext(req.id, ctx),
        { conversationId, threshold },
      );
    }

    case "conversation.memory.extract": {
      const params = req.params as { conversationId?: string; threshold?: number; refreshDigest?: boolean } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";
      const threshold = typeof params?.threshold === "number" && Number.isFinite(params.threshold)
        ? Math.max(1, Math.floor(params.threshold))
        : undefined;

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      return handleConversationMemoryExtractWithQueryRuntime(
        createConversationRuntimeContext(req.id, ctx),
        {
          conversationId,
          threshold,
          refreshDigest: params?.refreshDigest === true,
        },
      );
    }

    case "conversation.restore": {
      const params = req.params as { conversationId?: string } | undefined;
      const conversationId = typeof params?.conversationId === "string" ? params.conversationId.trim() : "";

      if (!conversationId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "conversationId is required" } };
      }

      return handleConversationRestoreWithQueryRuntime(
        createConversationRuntimeContext(req.id, ctx),
        { conversationId },
      );
    }

    default:
      return null;
  }
}
