import fs from "node:fs/promises";
import path from "node:path";

import type { AgentRegistry } from "@belldandy/agent";
import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import {
  buildVirtualCandidateFromPublishedAsset,
  listPublishedAssets,
} from "@belldandy/memory";
import {
  buildMemorySourceInventoryGovernanceSummary,
  buildExperienceSynthesisPreviewFromSourceCandidates,
  buildExperienceCandidateSlug,
  createTaskWorkSurface,
  getGlobalMemoryManager,
  readFirstMarkdownTitle,
  validateMethodCandidateDraftForPublish,
  validateSkillCandidateDraftForPublish,
} from "@belldandy/memory";
import type {
  ExperienceCandidate,
  ExperienceCandidateType,
  MemorySourceInventoryGovernanceSummary,
  ExperienceSynthesisPreviewItem,
  MemorySourceInventoryConfiguredSource,
  PublishedExperienceAssetRecord,
} from "@belldandy/memory";
import type { SkillRegistry } from "@belldandy/skills";
import { publishSkillCandidate } from "@belldandy/skills";

import { buildLearningReviewInput } from "../learning-review-input.js";
import { buildMemoryClassConsumerView } from "../memory-class-consumer-view.js";
import {
  buildEpisodicTaskFreshnessView,
  buildGovernanceFreshnessFromInventory,
  buildMemoryFreshnessView,
  buildProceduralExperienceFreshnessFromTaskDetail,
  buildProceduralExperienceFreshnessView,
  buildProfileSemanticFreshnessView,
  buildProjectSemanticFreshnessFromInventory,
  type MemoryFreshnessView,
} from "../memory-freshness-view.js";
import {
  normalizeConfiguredMemorySourcesInput,
  readConfiguredMemorySourcesStore,
  resolveConfiguredMemorySourcesPath,
  writeConfiguredMemorySourcesStore,
} from "../memory-configured-sources-store.js";
import { buildMindProfileSnapshot } from "../mind-profile-snapshot.js";
import type { ScopedMemoryManagerRecord } from "../resident-memory-managers.js";
import {
  attachResidentExperienceCandidateSourceView,
  attachResidentExperienceUsageSourceView,
  attachResidentMemorySourceView,
  attachResidentMemorySourceViews,
  attachResidentTaskExperienceSourceView,
  buildResidentMemoryQueryView,
} from "../resident-memory-result-view.js";
import {
  claimResidentSharedMemoryPromotion,
  getResidentMemory,
  listRecentResidentMemory,
  listResidentSharedReviewQueue,
  mergeResidentMemoryStatus,
  normalizeResidentSharedPromotionStatus,
  promoteResidentMemoryToShared,
  resolveResidentSharedMemoryManager,
  reviewResidentSharedMemoryPromotion,
  searchResidentMemoryWithDiagnostics,
} from "../resident-shared-memory.js";
import {
  buildSkillFreshnessSnapshot,
  findSkillFreshnessForCandidate,
  findSkillFreshnessForUsage,
} from "../skill-freshness.js";
import { updateSkillFreshnessManualMark } from "../skill-freshness-state.js";
import {
  resolveExperienceSynthesisTemplate,
  resolveExperienceSynthesisTemplateInfo,
} from "../experience-synthesis-template.js";
import { buildResidentSharedGovernancePreview } from "../resident-shared-governance-report.js";

type MemoryExperienceMethodContext = {
  stateDir: string;
  agentRegistry?: AgentRegistry;
  skillRegistry?: SkillRegistry;
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  teamSharedMemoryEnabled?: boolean;
  primaryModelConfig?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    thinking?: Record<string, unknown>;
    reasoningEffort?: string;
  };
  callPrimaryModel?: (input: {
    system: string;
    user: string;
    maxTokens?: number;
    model?: string;
    thinking?: Record<string, unknown>;
    reasoningEffort?: string;
  }) => Promise<string>;
  logger?: {
    debug?: (message: string, data?: unknown) => void;
    warn?: (message: string, data?: unknown) => void;
    error?: (message: string, data?: unknown) => void;
  };
};

type ExperienceSynthesisModelRequestConfig = {
  model?: string;
  thinking?: Record<string, unknown>;
  reasoningEffort?: string;
};

const DEFAULT_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES = 5;
const DEFAULT_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS = 1_600;
const DEFAULT_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET = 10_000;
const EXPERIENCE_SYNTHESIS_MODEL_CALL_TIMEOUT_MS = 120_000;
const EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES_ENV = "BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES";
const EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS_ENV = "BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS";
const EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET_ENV = "BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET";

export async function handleMemoryExperienceMethod(
  req: GatewayReqFrame,
  ctx: MemoryExperienceMethodContext,
): Promise<GatewayResFrame | null> {
  if (!req.method.startsWith("memory.") && !req.method.startsWith("experience.")) {
    return null;
  }

  const params = isObjectRecord(req.params) ? req.params : {};
  const logDebug = (message: string, data?: unknown) => ctx.logger?.debug?.(message, data);
  const logWarn = (message: string, data?: unknown) => ctx.logger?.warn?.(message, data);
  const logError = (message: string, data?: unknown) => ctx.logger?.error?.(message, data);

  switch (req.method) {
    case "memory.search": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const sharedManager = resolveResidentSharedMemoryManager(residentPolicy);
      if (!manager) return notAvailable(req.id);

      const query = readRequiredString(params, "query");
      if (!query) return invalid(req.id, "query is required");

      const limit = clampListLimit(params.limit, 20);
      const includeContent = params.includeContent !== false;
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const searchResult = await searchResidentMemoryWithDiagnostics({
        manager,
        sharedManager,
        residentPolicy,
        query,
        limit,
        filter: filter as any,
        includeContent,
      });
      return ok(req.id, {
        items: toMemoryListPayloadItems(searchResult.items, includeContent, residentPolicy),
        query,
        limit,
        diagnostics: searchResult.diagnostics,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.get": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const sharedManager = resolveResidentSharedMemoryManager(residentPolicy);
      if (!manager) return notAvailable(req.id);

      const chunkId = readRequiredString(params, "chunkId");
      if (!chunkId) return invalid(req.id, "chunkId is required");

      const item = getResidentMemory({ manager, sharedManager, residentPolicy, chunkId });
      if (!item) return notFound(req.id, "Memory not found.");

      return ok(req.id, {
        item: attachResidentMemorySourceView(item, residentPolicy),
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.recent": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const sharedManager = resolveResidentSharedMemoryManager(residentPolicy);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 20);
      const includeContent = params.includeContent !== false;
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = listRecentResidentMemory({
        manager,
        sharedManager,
        residentPolicy,
        limit,
        filter: filter as any,
        includeContent,
      });
      return ok(req.id, {
        items: toMemoryListPayloadItems(items, includeContent, residentPolicy),
        limit,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.stats": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const sharedManager = resolveResidentSharedMemoryManager(residentPolicy);
      if (!manager) return notAvailable(req.id);

      const includeRecentTasks = params.includeRecentTasks === true;
      const sharedStatus = residentPolicy?.includeSharedMemoryReads === true && sharedManager && sharedManager !== manager
        ? sharedManager.getStatus()
        : null;
      const sharedGovernance = buildSharedGovernanceCounts(manager, residentPolicy);
      return ok(req.id, {
        status: mergeResidentMemoryStatus(manager.getStatus(), sharedStatus),
        sharedGovernance: {
          ...sharedGovernance,
          trackedCount:
            sharedGovernance.pendingCount
            + sharedGovernance.approvedCount
            + sharedGovernance.rejectedCount
            + sharedGovernance.revokedCount,
        },
        queryView: buildResidentMemoryQueryView(residentPolicy),
        ...(includeRecentTasks ? { recentTasks: manager.getRecentTasks(5) } : {}),
      });
    }

    case "memory.configured_sources.get": {
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      try {
        const store = await readConfiguredMemorySourcesStore(ctx.stateDir);
        return ok(req.id, {
          path: resolveConfiguredMemorySourcesPath(ctx.stateDir),
          version: store.version,
          updatedAt: store.updatedAt ?? null,
          configuredSources: store.sources,
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        return invalid(req.id, error instanceof Error ? error.message : String(error));
      }
    }

    case "memory.configured_sources.update": {
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const configuredSourcesResult = normalizeConfiguredMemorySourcesInput(params.configuredSources, "configuredSources");
      if ("error" in configuredSourcesResult) {
        return invalid(req.id, configuredSourcesResult.error);
      }
      try {
        const store = await writeConfiguredMemorySourcesStore(ctx.stateDir, configuredSourcesResult.sources);
        return ok(req.id, {
          path: resolveConfiguredMemorySourcesPath(ctx.stateDir),
          version: store.version,
          updatedAt: store.updatedAt ?? null,
          configuredSources: store.sources,
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        return invalid(req.id, error instanceof Error ? error.message : String(error));
      }
    }

    case "memory.inventory.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const configuredSourcesResult = await resolveConfiguredInventorySources(params, ctx.stateDir);
      if ("error" in configuredSourcesResult) {
        return invalid(req.id, configuredSourcesResult.error);
      }

      const report = await manager.previewSourceInventory({
        configuredSources: configuredSourcesResult.sources,
      });
      const governance = buildMemorySourceInventoryGovernanceSummary(report);
      const memoryFreshness = buildMemoryFreshnessView({
        items: [
          buildProjectSemanticFreshnessFromInventory({
            governance,
            generatedAt: report.generatedAt,
            note: "当前只观测到 project semantic 的 inventory/tree 派生视图，本批未补 project truth state。",
          }),
          buildGovernanceFreshnessFromInventory({
            governance,
            generatedAt: report.generatedAt,
          }),
        ],
      });
      return ok(req.id, withMemoryClassConsumerPayload({
        report,
        governance,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      }, {
        presentClasses: ["governance"],
        partialClasses: ["project_semantic"],
        noteByClass: {
          project_semantic: "Inventory preview observes stable project semantics through source families and tree-facing governance views.",
          governance: "Inventory preview is a governance-facing read model over memory source lifecycle state.",
        },
        includeRegistry: true,
        registryClasses: ["project_semantic", "governance"],
      }, memoryFreshness));
    }

    case "memory.tree.report.inventory.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const configuredSourcesResult = await resolveConfiguredInventorySources(params, ctx.stateDir);
      if ("error" in configuredSourcesResult) {
        return invalid(req.id, configuredSourcesResult.error);
      }

      const report = await manager.previewSourceInventory({
        configuredSources: configuredSourcesResult.sources,
      });
      const record = manager.persistMemoryTreeInventoryReport(report, {
        configuredSources: configuredSourcesResult.sources,
        createdBy: "rpc",
      });
      const governance = readInventoryGovernanceSummary(record.summary?.governance, report);
      const memoryFreshness = buildMemoryFreshnessView({
        items: [
          buildProjectSemanticFreshnessFromInventory({
            governance,
            generatedAt: report.generatedAt,
            reportRecord: record,
            note: "当前只观测到 project semantic 的 inventory/tree 派生视图，本批未补 project truth state。",
          }),
          buildGovernanceFreshnessFromInventory({
            governance,
            generatedAt: report.generatedAt,
            reportRecord: record,
          }),
        ],
      });
      return ok(req.id, withMemoryClassConsumerPayload({
        report,
        governance,
        record,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      }, {
        presentClasses: ["governance"],
        partialClasses: ["project_semantic"],
        noteByClass: {
          project_semantic: "Inventory report preview still reaches project semantics through derived governance and tree-facing views.",
          governance: "Inventory report preview persists a governance artifact for later review and apply.",
        },
        includeRegistry: true,
        registryClasses: ["project_semantic", "governance"],
      }, memoryFreshness));
    }

    case "memory.tree.report.external_ingest.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const configuredSourcesResult = await resolveConfiguredInventorySources(params, ctx.stateDir, {
        singleSourceMessage: "external ingest preview requires exactly one configured source.",
      });
      if ("error" in configuredSourcesResult) {
        return invalid(req.id, configuredSourcesResult.error);
      }
      try {
        const report = await manager.previewConfiguredExternalIngest({
          configuredSources: configuredSourcesResult.sources,
        });
        const record = manager.persistMemoryTreeExternalIngestReport(report, {
          createdBy: "rpc",
        });
        return ok(req.id, {
          report,
          governance: record.summary?.governance ?? null,
          record,
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        return invalid(req.id, error instanceof Error ? error.message : String(error));
      }
    }

    case "memory.tree.report.dedup.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const maxGroups = clampListLimit(params.maxGroups, 50, 500);
      const report = manager.previewExactDedup(filter as any, { maxGroups });
      const record = manager.persistMemoryTreeDedupPreviewReport(report, {
        filter: filter as any,
        maxGroups,
        createdBy: "rpc",
      });
      return ok(req.id, {
        report,
        record,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.report.shared_governance.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const configuredSourcesResult = await resolveConfiguredInventorySources(params, ctx.stateDir);
      if ("error" in configuredSourcesResult) {
        return invalid(req.id, configuredSourcesResult.error);
      }

      const reviewerAgentId = extractReviewerMemoryAgentId(params)
        ?? residentPolicy?.agentId
        ?? "default";
      const preview = await buildResidentSharedGovernancePreview({
        stateDir: ctx.stateDir,
        manager,
        residentPolicy,
        residentRecords: ctx.residentMemoryManagers,
        agentRegistry: ctx.agentRegistry,
        reviewerAgentId,
        configuredSources: configuredSourcesResult.sources,
        teamSharedMemoryEnabled: ctx.teamSharedMemoryEnabled ?? (process.env.BELLDANDY_TEAM_SHARED_MEMORY_ENABLED === "true"),
      });
      const record = manager.recordMemoryTreeReport({
        reportType: "shared_governance_preview",
        scope: residentPolicy?.writeTarget === "shared" ? "shared" : "private",
        agentId: residentPolicy?.agentId,
        createdBy: "rpc",
        summary: preview.summary,
        details: preview.details,
      });
      return ok(req.id, withMemoryClassConsumerPayload({
        report: preview.report,
        governance: preview.report.governance,
        record,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      }, {
        presentClasses: ["governance"],
        partialClasses: ["project_semantic"],
        noteByClass: {
          project_semantic: "Shared governance preview can reflect stable project constraints, but not yet through a dedicated project truth payload.",
          governance: "Shared governance preview is an explicit governance read surface.",
        },
        includeRegistry: true,
        registryClasses: ["project_semantic", "governance"],
      }));
    }

    case "memory.tree.report.list": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 50, 500);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = manager.listMemoryTreeReports(limit, filter as any);
      return ok(req.id, {
        items,
        limit,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.report.get": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const reportId = readRequiredString(params, "reportId");
      if (!reportId) return invalid(req.id, "reportId is required");
      const report = manager.getMemoryTreeReport(reportId);
      if (!report) return notFound(req.id, "Memory tree report not found.");
      return ok(req.id, {
        report,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.report.export_markdown": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const reportId = readRequiredString(params, "reportId");
      if (!reportId) return invalid(req.id, "reportId is required");
      const result = await manager.exportMemoryTreeReportMarkdown(reportId);
      return ok(req.id, {
        ...result,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.report.review": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const reportId = readRequiredString(params, "reportId");
      if (!reportId) return invalid(req.id, "reportId is required");
      const decision = readRequiredString(params, "decision");
      if (!isMemoryTreeReportReviewDecision(decision)) {
        return invalid(req.id, "decision must be approved, rejected, or superseded.");
      }
      const reviewedBy = readOptionalString(params, "reviewedBy")
        ?? readOptionalString(params, "agentId")
        ?? "rpc";
      const note = readOptionalString(params, "note");
      try {
        const result = manager.reviewMemoryTreeReport(reportId, decision, {
          reviewedBy,
          note,
        });
        return ok(req.id, {
          result,
          report: result.report,
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("not found")) {
          return notFound(req.id, message);
        }
        return invalid(req.id, message);
      }
    }

    case "memory.tree.report.apply": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const confirmed = params.confirmed === true;
      if (!confirmed) {
        return confirmationRequired(req.id, "memory.tree.report.apply requires explicit confirmed=true because it mutates memory.sqlite.");
      }
      const reportId = readRequiredString(params, "reportId");
      if (!reportId) return invalid(req.id, "reportId is required");
      const appliedBy = readOptionalString(params, "appliedBy")
        ?? readOptionalString(params, "agentId")
        ?? "rpc";
      const note = readOptionalString(params, "note");
      try {
        const result = await manager.applyMemoryTreeReport(reportId, {
          appliedBy,
          note,
        });
        return ok(req.id, {
          result,
          report: result.report,
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("not found")) {
          return notFound(req.id, message);
        }
        return invalid(req.id, message);
      }
    }

    case "memory.tree.lifecycle.get": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const kinds = readManagedMemoryTreeNodeKinds(params, "kinds");
      if (kinds === null) {
        return invalid(req.id, "kinds must only contain topic, profile, or global.");
      }
      const snapshot = manager.getMemoryTreeLifecycleSnapshot({ kinds: kinds ?? undefined });
      return ok(req.id, {
        snapshot,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.lifecycle.report": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const kinds = readManagedMemoryTreeNodeKinds(params, "kinds");
      if (kinds === null) {
        return invalid(req.id, "kinds must only contain topic, profile, or global.");
      }
      const report = manager.getMemoryTreeLifecycleReport({ kinds: kinds ?? undefined });
      return ok(req.id, {
        report,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.job.report": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const kinds = readManagedMemoryTreeNodeKinds(params, "kinds");
      if (kinds === null) {
        return invalid(req.id, "kinds must only contain topic, profile, or global.");
      }
      const report = manager.getMemoryTreeJobReport({ kinds: kinds ?? undefined });
      return ok(req.id, {
        report,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.lifecycle.ensure": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const kinds = readManagedMemoryTreeNodeKinds(params, "kinds");
      if (kinds === null) {
        return invalid(req.id, "kinds must only contain topic, profile, or global.");
      }
      const rebuildSources = readOptionalBoolean(params, "rebuildSources");
      let configuredSources: MemorySourceInventoryConfiguredSource[] | undefined;
      if (rebuildSources !== false) {
        const configuredSourcesResult = await resolveConfiguredInventorySources(params, ctx.stateDir);
        if ("error" in configuredSourcesResult) {
          return invalid(req.id, configuredSourcesResult.error);
        }
        configuredSources = configuredSourcesResult.sources;
      }
      const nodeLimit = clampListLimit(params.nodeLimit, 20, 200);
      const result = await manager.ensureManagedMemoryTreeFresh({
        configuredSources,
        kinds: kinds ?? undefined,
        nodeLimit,
        rebuildSources,
      });
      return ok(req.id, {
        result,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.node.rebuild": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 100, 500);
      const kind = readOptionalString(params, "kind");
      if (kind && !isMemoryTreeNodeKind(kind)) {
        return invalid(req.id, "kind must be task, conversation, day, topic, project, agent, profile, or global.");
      }
      const result = manager.rebuildMemoryTreeNodes({ limit, kind: kind as any });
      return ok(req.id, {
        result,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.node.list": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 100, 500);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = manager.listMemoryTreeNodes(limit, filter as any);
      return ok(req.id, {
        items,
        limit,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.node.search": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const query = readRequiredString(params, "query");
      if (!query) return invalid(req.id, "query is required");
      const limit = clampListLimit(params.limit, 10, 100);
      const chunkLimitPerNode = clampListLimit(params.chunkLimitPerNode, 5, 50);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = manager.searchMemoryTreeNodes(query, {
        limit,
        chunkLimitPerNode,
        filter: filter as any,
      });
      return ok(req.id, {
        items,
        query,
        limit,
        chunkLimitPerNode,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.node.get": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const nodeId = readRequiredString(params, "nodeId");
      if (!nodeId) return invalid(req.id, "nodeId is required");
      const chunkLimit = clampListLimit(params.chunkLimit, 20, 100);
      const detail = manager.getMemoryTreeNodeDetail(nodeId, { chunkLimit });
      if (!detail) return notFound(req.id, "Memory tree node not found.");
      return ok(req.id, {
        node: detail.node,
        edges: detail.edges,
        chunks: attachResidentMemorySourceViews(detail.chunks, residentPolicy),
        sources: detail.sources,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.source.rebuild": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const configuredSourcesResult = await resolveConfiguredInventorySources(params, ctx.stateDir);
      if ("error" in configuredSourcesResult) {
        return invalid(req.id, configuredSourcesResult.error);
      }

      const result = await manager.rebuildMemoryTreeSources({
        configuredSources: configuredSourcesResult.sources,
      });
      return ok(req.id, {
        result,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.source.list": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 100, 500);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = manager.listMemoryTreeSources(limit, filter as any);
      return ok(req.id, {
        items,
        limit,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.score.rebuild": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const result = manager.rebuildMemoryTreeScores();
      return ok(req.id, {
        result,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.tree.score.list": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 100, 500);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = manager.listMemoryTreeScores(limit, filter as any);
      return ok(req.id, {
        items,
        limit,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.dedup.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const maxGroups = clampListLimit(params.maxGroups, 50, 500);
      const report = manager.previewExactDedup(filter as any, { maxGroups });
      return ok(req.id, {
        report,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.dedup.apply": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const confirmed = params.confirmed === true;
      if (!confirmed) {
        return confirmationRequired(req.id, "memory.dedup.apply requires explicit confirmed=true because it mutates memory.sqlite.");
      }
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const maxGroups = clampListLimit(params.maxGroups, 50, 500);
      const runId = readOptionalString(params, "runId");
      const backupRootDir = path.join(ctx.stateDir, "artifacts", "memory-dedup-backups");
      await fs.mkdir(backupRootDir, { recursive: true });
      const result = manager.applyExactDedup(filter as any, {
        backupRootDir,
        maxGroups,
        runId,
      });
      return ok(req.id, {
        result,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.vacuum.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const report = manager.previewMemoryVacuum();
      return ok(req.id, {
        report,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.vacuum.apply": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const confirmed = params.confirmed === true;
      if (!confirmed) {
        return confirmationRequired(req.id, "memory.vacuum.apply requires explicit confirmed=true because it rewrites memory.sqlite.");
      }
      const runId = readOptionalString(params, "runId");
      const backupRootDir = path.join(ctx.stateDir, "artifacts", "memory-vacuum-backups");
      await fs.mkdir(backupRootDir, { recursive: true });
      const result = manager.applyMemoryVacuum({
        backupRootDir,
        runId,
      });
      return ok(req.id, {
        result,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "memory.share.queue": {
      const limit = clampListLimit(params.limit, 50, 200);
      const query = readOptionalString(params, "query") ?? "";
      const filter = isObjectRecord(params.filter) ? params.filter : {};
      const reviewerAgentId = extractReviewerMemoryAgentId(params) ?? "default";
      if ((ctx.residentMemoryManagers?.length ?? 0) <= 0) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "not_available", message: "Resident memory managers are not available." },
        };
      }

      const queue = listResidentSharedReviewQueue({
        records: ctx.residentMemoryManagers ?? [],
        agentRegistry: ctx.agentRegistry,
        reviewerAgentId,
        limit,
        query,
        filter: {
          sharedPromotionStatus: Array.isArray(filter.sharedPromotionStatus)
            ? filter.sharedPromotionStatus
              .map((item) => normalizeResidentSharedPromotionStatus(item))
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
            : normalizeResidentSharedPromotionStatus(filter.sharedPromotionStatus),
          targetAgentId: typeof filter.targetAgentId === "string" ? filter.targetAgentId.trim() : undefined,
          claimedByAgentId: typeof filter.claimedByAgentId === "string" ? filter.claimedByAgentId.trim() : undefined,
          actionableOnly: filter.actionableOnly === true,
        },
      });
      return ok(req.id, {
        reviewerAgentId,
        limit,
        items: queue.items.map((item) => {
          const targetPolicy = resolveResidentMemoryManagerRecord(item.targetAgentId, ctx.residentMemoryManagers)?.policy;
          return {
            ...attachResidentMemorySourceView(item, targetPolicy),
            targetAgentId: item.targetAgentId,
            targetDisplayName: item.targetDisplayName,
            targetMemoryMode: item.targetMemoryMode,
            reviewStatus: item.reviewStatus,
            actionableByReviewer: item.actionableByReviewer,
            blockedByOtherReviewer: item.blockedByOtherReviewer,
          };
        }),
        summary: queue.summary,
      });
    }

    case "memory.share.promote": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const sharedManager = resolveResidentSharedMemoryManager(residentPolicy);
      if (!manager) return notAvailable(req.id);

      const agentId = extractScopedMemoryAgentId(params) ?? residentPolicy?.agentId ?? "default";
      const chunkId = readOptionalString(params, "chunkId") ?? "";
      const sourcePath = readOptionalString(params, "sourcePath") ?? "";
      const reason = readOptionalString(params, "reason") ?? "";
      if (!chunkId && !sourcePath) return invalid(req.id, "chunkId or sourcePath is required.");

      try {
        const result = promoteResidentMemoryToShared({
          manager,
          sharedManager,
          residentPolicy,
          agentId,
          chunkId: chunkId || undefined,
          sourcePath: sourcePath || undefined,
          reason,
        });
        return ok(req.id, {
          promoted: true,
          promotedCount: result.promotedCount,
          mode: result.mode,
          reason: result.reason,
          item: result.item ? attachResidentMemorySourceView(result.item, residentPolicy) : null,
          items: result.items.map((item) => attachResidentMemorySourceView(item, residentPolicy)),
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        return failure(req.id, "memory_share_promote_failed", error);
      }
    }

    case "memory.share.review": {
      const targetAgentId = extractTargetMemoryAgentId(params) ?? "default";
      const targetRecord = resolveResidentMemoryManagerRecord(targetAgentId, ctx.residentMemoryManagers);
      const manager = targetRecord?.manager ?? resolveScopedMemoryManager({ agentId: targetAgentId });
      const residentPolicy = targetRecord?.policy ?? resolveScopedResidentMemoryPolicy({ agentId: targetAgentId }, ctx.residentMemoryManagers);
      const sharedManager = resolveResidentSharedMemoryManager(residentPolicy);
      if (!manager) return notAvailable(req.id);

      const chunkId = readOptionalString(params, "chunkId") ?? "";
      const sourcePath = readOptionalString(params, "sourcePath") ?? "";
      const decision = readOptionalString(params, "decision") ?? "";
      const note = readOptionalString(params, "note") ?? "";
      if (!chunkId && !sourcePath) return invalid(req.id, "chunkId or sourcePath is required.");
      if (!["approved", "rejected", "revoked"].includes(decision)) {
        return invalid(req.id, "decision must be approved, rejected, or revoked.");
      }
      const reviewerAgentId = extractReviewerMemoryAgentId(params) ?? targetAgentId;

      try {
        const result = reviewResidentSharedMemoryPromotion({
          manager,
          sharedManager,
          agentId: reviewerAgentId,
          chunkId: chunkId || undefined,
          sourcePath: sourcePath || undefined,
          decision: decision as "approved" | "rejected" | "revoked",
          note: note || undefined,
        });
        return ok(req.id, {
          targetAgentId,
          reviewerAgentId,
          decision: result.decision,
          reviewedCount: result.reviewedCount,
          mode: result.mode,
          privateItem: result.privateItem ? attachResidentMemorySourceView(result.privateItem, residentPolicy) : null,
          sharedItem: result.sharedItem ? attachResidentMemorySourceView(result.sharedItem, residentPolicy) : null,
          privateItems: result.privateItems?.map((item) => attachResidentMemorySourceView(item, residentPolicy)) ?? [],
          sharedItems: result.sharedItems?.map((item) => attachResidentMemorySourceView(item, residentPolicy)) ?? [],
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        return failure(req.id, "memory_share_review_failed", error);
      }
    }

    case "memory.share.claim": {
      const targetAgentId = extractTargetMemoryAgentId(params) ?? "default";
      const targetRecord = resolveResidentMemoryManagerRecord(targetAgentId, ctx.residentMemoryManagers);
      const manager = targetRecord?.manager ?? resolveScopedMemoryManager({ agentId: targetAgentId });
      const residentPolicy = targetRecord?.policy ?? resolveScopedResidentMemoryPolicy({ agentId: targetAgentId }, ctx.residentMemoryManagers);
      const sharedManager = resolveResidentSharedMemoryManager(residentPolicy);
      if (!manager) return notAvailable(req.id);

      const chunkId = readOptionalString(params, "chunkId") ?? "";
      const sourcePath = readOptionalString(params, "sourcePath") ?? "";
      const action = readOptionalString(params, "action") ?? "";
      if (!chunkId && !sourcePath) return invalid(req.id, "chunkId or sourcePath is required.");
      if (!["claim", "release"].includes(action)) return invalid(req.id, "action must be claim or release.");
      const reviewerAgentId = extractReviewerMemoryAgentId(params) ?? targetAgentId;

      try {
        const result = claimResidentSharedMemoryPromotion({
          manager,
          sharedManager,
          agentId: reviewerAgentId,
          action: action as "claim" | "release",
          chunkId: chunkId || undefined,
          sourcePath: sourcePath || undefined,
        });
        return ok(req.id, {
          targetAgentId,
          reviewerAgentId,
          action: result.action,
          claimedCount: result.claimedCount,
          mode: result.mode,
          privateItem: result.privateItem ? attachResidentMemorySourceView(result.privateItem, residentPolicy) : null,
          sharedItem: result.sharedItem ? attachResidentMemorySourceView(result.sharedItem, residentPolicy) : null,
          privateItems: result.privateItems.map((item) => attachResidentMemorySourceView(item, residentPolicy)),
          sharedItems: result.sharedItems.map((item) => attachResidentMemorySourceView(item, residentPolicy)),
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        return failure(req.id, "memory_share_claim_failed", error);
      }
    }

    case "memory.task.list": {
      const manager = resolveScopedMemoryManager(params);
      if (!manager) return notAvailable(req.id);

      const query = readOptionalString(params, "query") ?? "";
      const limit = clampListLimit(params.limit, 20);
      const summaryOnly = params.summaryOnly === true;
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = query
        ? manager.searchTasks(query, { limit, filter: filter as any })
        : manager.getRecentTasks(limit, filter as any);

      return ok(req.id, {
        items: toTaskListPayloadItems(items, summaryOnly),
        query,
        limit,
      });
    }

    case "memory.task.get": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const taskId = readRequiredString(params, "taskId");
      if (!taskId) return invalid(req.id, "taskId is required");

      const task = manager.getTaskDetail(taskId);
      if (!task) return notFound(req.id, "Task not found.");
      const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);
      const taskPayload = toTaskExperiencePayloadItem(manager, task, residentPolicy) as Record<string, unknown> & {
        usedSkills?: Array<Record<string, unknown>>;
      };
      taskPayload.usedSkills = (Array.isArray(taskPayload.usedSkills) ? taskPayload.usedSkills : []).map((item, index) =>
        attachSkillFreshnessToUsagePayload(item, task.usedSkills?.[index], skillFreshnessSnapshot),
      );
      const memoryFreshness = buildMemoryFreshnessView({
        items: [
          buildEpisodicTaskFreshnessView(task),
          buildProceduralExperienceFreshnessFromTaskDetail(task, skillFreshnessSnapshot),
        ],
      });

      return ok(req.id, withMemoryClassConsumerPayload({
        task: taskPayload,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      }, {
        presentClasses: ["episodic_task"],
        partialClasses: [
          ...((task.usedMethods?.length ?? 0) + (task.usedSkills?.length ?? 0) > 0 ? ["procedural_experience" as const] : []),
        ],
        noteByClass: {
          episodic_task: "Task detail reads canonical task records plus derived recap, resume, and activity evidence.",
          procedural_experience: "Task detail can include linked method/skill usage, but it is still primarily an episodic task surface.",
        },
      }, memoryFreshness));
    }

    case "memory.recent_work": {
      const taskWorkSurface = resolveScopedTaskWorkSurface(params);
      if (!taskWorkSurface) return notAvailable(req.id);

      const query = readOptionalString(params, "query") ?? "";
      const limit = clampListLimit(params.limit, 10);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = taskWorkSurface.recentWork({
        query: query || undefined,
        limit,
        filter: filter as any,
      });

      return ok(req.id, withMemoryClassConsumerPayload({
        items,
        query,
        limit,
      }, {
        presentClasses: ["episodic_task"],
        noteByClass: {
          episodic_task: "recent_work is a derived episodic task surface built from task recap and recent activity.",
        },
      }));
    }

    case "memory.resume_context": {
      const taskWorkSurface = resolveScopedTaskWorkSurface(params);
      if (!taskWorkSurface) return notAvailable(req.id);

      const query = readOptionalString(params, "query") ?? "";
      const taskId = readOptionalString(params, "taskId") ?? "";
      const conversationId = readOptionalString(params, "conversationId") ?? "";
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const item = taskWorkSurface.resumeContext({
        taskId: taskId || undefined,
        conversationId: conversationId || undefined,
        query: query || undefined,
        filter: filter as any,
      });

      return ok(req.id, withMemoryClassConsumerPayload({
        item,
        query,
        taskId: taskId || undefined,
        conversationId: conversationId || undefined,
      }, {
        presentClasses: ["episodic_task"],
        noteByClass: {
          episodic_task: "resume_context is a derived episodic task surface for stop point and next-step recovery.",
        },
      }));
    }

    case "memory.similar_past_work": {
      const taskWorkSurface = resolveScopedTaskWorkSurface(params);
      if (!taskWorkSurface) return notAvailable(req.id);

      const query = readRequiredString(params, "query");
      if (!query) return invalid(req.id, "query is required");

      const limit = clampListLimit(params.limit, 10);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = taskWorkSurface.findSimilarWork({
        query,
        limit,
        filter: filter as any,
      });

      return ok(req.id, withMemoryClassConsumerPayload({
        items,
        query,
        limit,
      }, {
        presentClasses: ["episodic_task"],
        noteByClass: {
          episodic_task: "similar_past_work compares derived episodic task evidence across prior tasks.",
        },
      }));
    }

    case "memory.explain_sources": {
      const taskWorkSurface = resolveScopedTaskWorkSurface(params);
      if (!taskWorkSurface) return notAvailable(req.id);

      const taskId = readOptionalString(params, "taskId") ?? "";
      const conversationId = readOptionalString(params, "conversationId") ?? "";
      if (!taskId && !conversationId) {
        return invalid(req.id, "taskId or conversationId is required");
      }

      const explanation = taskWorkSurface.explainSources({
        taskId: taskId || undefined,
        conversationId: conversationId || undefined,
      });
      if (!explanation) {
        return notFound(req.id, "Task work source explanation not found.");
      }

      return ok(req.id, withMemoryClassConsumerPayload({
        explanation,
        taskId: explanation.taskId,
        conversationId: explanation.conversationId,
      }, {
        presentClasses: ["episodic_task"],
        noteByClass: {
          episodic_task: "explain_sources traces episodic task evidence back to recap, resume, and activity source refs.",
        },
      }));
    }

    case "experience.candidate.get": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const candidateId = readRequiredString(params, "candidateId");
      if (!candidateId) return invalid(req.id, "candidateId is required");

      const candidate = manager.getExperienceCandidate(candidateId);
      if (!candidate) return notFound(req.id, "Experience candidate not found.");
      const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);
      const candidateSkillFreshness = findSkillFreshnessForCandidate(skillFreshnessSnapshot, candidate);
      const mindProfileSnapshot = await buildMindProfileSnapshot({
        stateDir: ctx.stateDir,
        residentMemoryManagers: ctx.residentMemoryManagers,
        agentId: readOptionalString(params, "agentId"),
      });
      const learningReviewInput = buildLearningReviewInput({
        mindProfileSnapshot,
        experienceCandidate: candidate,
        experienceCandidateSkillFreshness: candidateSkillFreshness,
      });
      const memoryFreshness = buildMemoryFreshnessView({
        items: [
          buildProfileSemanticFreshnessView(mindProfileSnapshot),
          buildProceduralExperienceFreshnessView({
            candidate,
            skillFreshness: candidateSkillFreshness,
          }),
        ],
      });

      return ok(req.id, withMemoryClassConsumerPayload({
        candidate: attachSkillFreshnessToCandidatePayload({
          ...toExperienceCandidatePayloadItem(candidate, residentPolicy),
          learningReviewInput,
        }, candidate, skillFreshnessSnapshot),
        queryView: buildResidentMemoryQueryView(residentPolicy),
      }, {
        presentClasses: ["procedural_experience", ...(mindProfileSnapshot ? ["profile_semantic" as const] : [])],
        partialClasses: [
          ...(candidate.sourceTaskSnapshot ? ["episodic_task" as const] : []),
        ],
        noteByClass: {
          profile_semantic: "candidate.get includes a mind/profile snapshot for learning-review seeding.",
          episodic_task: "candidate.get carries only a source task snapshot, not a full episodic task detail payload.",
          procedural_experience: "candidate.get is the canonical procedural experience review surface.",
          project_semantic: "candidate.get still does not inject explicit project semantic state.",
          governance: "candidate.get exposes learning review input but not a full governance queue summary.",
        },
      }, memoryFreshness));
    }

    case "experience.candidate.generate": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const taskId = readRequiredString(params, "taskId");
      const candidateType = readRequiredString(params, "candidateType");
      if (!taskId) return invalid(req.id, "taskId is required");
      if (candidateType !== "method" && candidateType !== "skill") {
        return invalid(req.id, "candidateType must be method or skill.");
      }
      if (isExperienceGenerationConfirmationRequired(candidateType)) {
        return confirmationRequired(req.id, `${candidateType} generation requires user confirmation.`);
      }

      const result = candidateType === "method"
        ? manager.promoteTaskToMethodCandidate(taskId)
        : manager.promoteTaskToSkillCandidate(taskId);
      if (!result?.candidate) return notFound(req.id, "Task not found.");

      const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);
      return ok(req.id, {
        candidate: attachSkillFreshnessToCandidatePayload(
          toExperienceCandidatePayloadItem(result.candidate, residentPolicy),
          result.candidate,
          skillFreshnessSnapshot,
        ),
        created: !result.reusedExisting,
        reusedExisting: result.reusedExisting,
        dedupDecision: result.dedupDecision,
        exactMatch: result.exactMatch,
        similarMatches: result.similarMatches,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.candidate.check_duplicate": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const taskId = readRequiredString(params, "taskId");
      const candidateType = readRequiredString(params, "candidateType");
      if (!taskId) return invalid(req.id, "taskId is required");
      if (candidateType !== "method" && candidateType !== "skill") {
        return invalid(req.id, "candidateType must be method or skill.");
      }

      const result = candidateType === "method"
        ? manager.checkTaskMethodCandidateDuplicate(taskId)
        : manager.checkTaskSkillCandidateDuplicate(taskId);
      if (!result) return notFound(req.id, "Task not found.");

      return ok(req.id, {
        type: result.type,
        taskId: result.taskId,
        title: result.title,
        slug: result.slug,
        summary: result.summary,
        decision: result.decision,
        exactMatch: result.exactMatch,
        similarMatches: result.similarMatches,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.candidate.list": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 50);
      const offset = readOptionalNonNegativeInteger(params, "offset") ?? 0;
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const normalizedFilter = filter
        ? {
          ...filter,
          ...(typeof filter.synthesisConsumed === "boolean"
            ? { synthesisConsumed: filter.synthesisConsumed }
            : {}),
          ...(readOptionalString(filter, "consumedByCandidateId")
            ? { consumedByCandidateId: readOptionalString(filter, "consumedByCandidateId") }
            : {}),
        }
        : undefined;
      const items = manager.listExperienceCandidates(limit, normalizedFilter as any, offset);
      const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);
      return ok(req.id, {
        items: items.map((item) => attachSkillFreshnessToCandidatePayload(
          toExperienceCandidatePayloadItem(item, residentPolicy),
          item,
          skillFreshnessSnapshot,
        )),
        limit,
        offset,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.candidate.stats": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      return ok(req.id, {
        stats: manager.getExperienceCandidateStats(filter as any),
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.asset.list": {
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const limit = clampListLimit(params.limit, 50, 500);
      const rawType = readOptionalString(params, "type");
      const assetType = rawType
        ? normalizePublishedAssetType(rawType)
        : undefined;
      if (rawType && !assetType) {
        return invalid(req.id, "type must be method or skill.");
      }
      const items = listPublishedAssets(ctx.stateDir, assetType)
        .sort(comparePublishedAssetRecords)
        .slice(0, limit)
        .map((item) => toPublishedExperienceAssetPayloadItem(item));
      return ok(req.id, {
        items,
        limit,
        ...(assetType ? { type: assetType } : {}),
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.asset.read": {
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      const assetPath = readRequiredString(params, "assetPath");
      if (!assetPath) return invalid(req.id, "assetPath is required");
      const assetPathValidationError = getPublishedAssetPathValidationError(ctx.stateDir, assetPath);
      if (assetPathValidationError) {
        return invalid(req.id, assetPathValidationError);
      }
      const asset = findPublishedAssetRecordByPath(ctx.stateDir, assetPath);
      if (!asset) {
        return notFound(req.id, "Published asset not found.");
      }
      return ok(req.id, {
        asset: toPublishedExperienceAssetDetailPayloadItem(asset),
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.candidate.accept": {
      const manager = resolveScopedMemoryManager(params);
      if (!manager) return notAvailable(req.id);

      const candidateId = readRequiredString(params, "candidateId");
      const confirmed = readOptionalBoolean(params, "confirmed") === true;
      const publishTargetPath = readOptionalString(params, "publishTargetPath");
      if (!candidateId) return invalid(req.id, "candidateId is required");

      const existing = manager.getExperienceCandidate(candidateId);
      if (!existing) return notFound(req.id, "Experience candidate not found.");
      if (existing.status !== "draft") {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "invalid_state",
            message: `Experience candidate can only be accepted from draft status. Current status: ${existing.status}.`,
          },
        };
      }
      const publishTargetValidationError = publishTargetPath
        ? getPublishedAssetPublishTargetValidationError(ctx.stateDir, existing.type, publishTargetPath)
        : "";
      if (publishTargetValidationError) {
        return invalid(req.id, publishTargetValidationError);
      }
      const overwriteAsset = publishTargetPath
        ? findPublishedAssetRecordByPath(ctx.stateDir, publishTargetPath)
        : null;
      if (isExperiencePublishConfirmationRequired(existing.type) && !confirmed) {
        return confirmationRequired(req.id, `${existing.type} publish requires user confirmation.`);
      }

      try {
        let publishedPath: string | undefined;
        if (existing.type === "skill") {
          publishedPath = await publishSkillCandidate(existing, ctx.stateDir, ctx.skillRegistry, publishTargetPath
            ? {
              publishedPath: publishTargetPath,
              skillName: overwriteAsset?.metadata?.name || overwriteAsset?.key,
            }
            : {});
        }

        const candidate = manager.acceptExperienceCandidate(candidateId, {
          ...(publishTargetPath ? { publishedPath: publishTargetPath } : {}),
          ...(publishedPath ? { publishedPath } : {}),
        });
        if (!candidate) return notFound(req.id, "Experience candidate not found.");
        return ok(req.id, { candidate });
      } catch (error) {
        return failure(req.id, "experience_candidate_publish_failed", error);
      }
    }

    case "experience.candidate.reject": {
      const manager = resolveScopedMemoryManager(params);
      if (!manager) return notAvailable(req.id);

      const candidateId = readRequiredString(params, "candidateId");
      if (!candidateId) return invalid(req.id, "candidateId is required");

      const existing = manager.getExperienceCandidate(candidateId);
      if (!existing) return notFound(req.id, "Experience candidate not found.");
      if (existing.status !== "draft") {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "invalid_state",
            message: `Experience candidate can only be rejected from draft status. Current status: ${existing.status}.`,
          },
        };
      }

      const candidate = manager.rejectExperienceCandidate(candidateId);
      if (!candidate) return notFound(req.id, "Experience candidate not found.");
      return ok(req.id, { candidate });
    }

    case "experience.candidate.reject_bulk": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const filter = isObjectRecord(params.filter) ? { ...params.filter } : {};
      const rawType = typeof filter.type === "string" ? filter.type.trim().toLowerCase() : "";
      if (rawType !== "method" && rawType !== "skill") {
        return invalid(req.id, "filter.type must be 'method' or 'skill'");
      }

      const count = manager.rejectExperienceCandidates({
        ...(filter as any),
        type: rawType,
        status: "draft",
      });
      return ok(req.id, {
        count,
        filter: {
          type: rawType,
          status: "draft",
        },
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.candidate.cleanup_consumed": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const count = manager.deleteExperienceCandidates({
        status: "draft",
        synthesisConsumed: true,
      });
      logDebug("Experience consumed draft cleanup completed", {
        count,
        filter: {
          status: "draft",
          synthesisConsumed: true,
        },
      });
      return ok(req.id, {
        count,
        filter: {
          status: "draft",
          synthesisConsumed: true,
        },
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.candidate.synthesize.preview": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const candidateId = readOptionalString(params, "candidateId");
      const assetPath = readOptionalString(params, "assetPath");
      const limit = clampListLimit(params.limit, 50, 200);
      if (!candidateId && !assetPath) {
        logWarn("Experience synthesis preview rejected because candidateId is missing", {
          limit,
        });
        return invalid(req.id, "candidateId or assetPath is required");
      }
      const assetPathValidationError = assetPath
        ? getPublishedAssetPathValidationError(ctx.stateDir, assetPath)
        : "";
      if (assetPathValidationError) {
        logWarn("Experience synthesis preview rejected because assetPath is invalid", {
          assetPath,
          limit,
          reason: assetPathValidationError,
        });
        return invalid(req.id, assetPathValidationError);
      }

      const virtualSeedCandidate = assetPath
        ? resolveVirtualPublishedSeedCandidate(ctx.stateDir, assetPath)
        : null;
      const seedCandidate = candidateId
        ? manager.getExperienceCandidate(candidateId)
        : virtualSeedCandidate;
      if (!seedCandidate) {
        logWarn("Experience synthesis preview rejected because seed candidate was not found", {
          candidateId,
          assetPath,
          limit,
        });
        return notFound(req.id, "Experience candidate not found.");
      }

      const preview = candidateId
        ? manager.previewExperienceCandidateSynthesis(candidateId, { limit })
        : buildVirtualCandidateSynthesisPreview(manager, ctx.stateDir, seedCandidate, limit);
      if (!preview) {
        logWarn("Experience synthesis preview rejected because preview data could not be prepared", {
          candidateId,
          assetPath,
          candidateType: seedCandidate.type,
          limit,
        });
        return notFound(req.id, "Experience candidate not found.");
      }
      const maxSimilarSources = getExperienceSynthesisMaxSimilarSources();
      const selection = selectExperienceSynthesisPreviewItems(preview.items, maxSimilarSources);
      const selectedSourceCandidateIds = [seedCandidate.id, ...selection.selectedItems.map((item) => item.candidateId)];
      logDebug("Experience synthesis preview prepared", {
        candidateId: seedCandidate.id,
        candidateType: seedCandidate.type,
        limit,
        totalCount: preview.totalCount,
        matchedCount: preview.items.length,
        taskCount: preview.taskCount,
        sameFamilyCount: selection.sameFamilyCount,
        similarCount: selection.similarCount,
        selectedSameFamilyCount: selection.selectedSameFamilyCount,
        selectedSimilarCount: selection.selectedSimilarCount,
        maxSimilarSources,
      });

      const templateInfo = await resolveExperienceSynthesisTemplateInfo(ctx.stateDir, seedCandidate.type);
      return ok(req.id, {
        seedCandidate: toExperienceCandidatePayloadItem(seedCandidate, residentPolicy),
        candidateType: seedCandidate.type,
        totalCount: preview.totalCount,
        taskCount: preview.taskCount,
        items: preview.items,
        sourceCandidateIds: selectedSourceCandidateIds,
        selectedSourceCount: selectedSourceCandidateIds.length,
        sameFamilyCount: selection.sameFamilyCount,
        similarCount: selection.similarCount,
        selectedSameFamilyCount: selection.selectedSameFamilyCount,
        selectedSimilarCount: selection.selectedSimilarCount,
        maxSimilarSourceCount: maxSimilarSources,
        templateInfo,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.candidate.synthesize.create": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const candidateId = readOptionalString(params, "candidateId");
      const assetPath = readOptionalString(params, "assetPath");
      if (!candidateId && !assetPath) {
        logWarn("Experience synthesis create rejected because candidateId is missing", {
          requestedSourceCount: readOptionalStringArray(params, "sourceCandidateIds").length,
        });
        return invalid(req.id, "candidateId or assetPath is required");
      }
      const assetPathValidationError = assetPath
        ? getPublishedAssetPathValidationError(ctx.stateDir, assetPath)
        : "";
      if (assetPathValidationError) {
        logWarn("Experience synthesis create rejected because assetPath is invalid", {
          assetPath,
          requestedSourceCount: readOptionalStringArray(params, "sourceCandidateIds").length,
          reason: assetPathValidationError,
        });
        return invalid(req.id, assetPathValidationError);
      }
      const virtualSeedCandidate = assetPath
        ? resolveVirtualPublishedSeedCandidate(ctx.stateDir, assetPath)
        : null;
      const seedCandidate = candidateId
        ? manager.getExperienceCandidate(candidateId)
        : virtualSeedCandidate;
      if (!seedCandidate) {
        logWarn("Experience synthesis create rejected because seed candidate was not found", {
          candidateId,
          assetPath,
          requestedSourceCount: readOptionalStringArray(params, "sourceCandidateIds").length,
        });
        return notFound(req.id, "Experience candidate not found.");
      }
      const allowPublishedSources = !candidateId && Boolean(assetPath);
      if (!allowPublishedSources && seedCandidate.status !== "draft") {
        logWarn("Experience synthesis create rejected because seed candidate is not draft", {
          candidateId: seedCandidate.id,
          candidateType: seedCandidate.type,
          status: seedCandidate.status,
        });
        return invalid(req.id, `Only draft candidates can be synthesized. Current status: ${seedCandidate.status}.`);
      }

      const preview = allowPublishedSources
        ? buildVirtualCandidateSynthesisPreview(manager, ctx.stateDir, seedCandidate, 200)
        : manager.previewExperienceCandidateSynthesis(seedCandidate.id, { limit: 200 });
      if (!preview) {
        logWarn("Experience synthesis create rejected because preview data could not be prepared", {
          candidateId: seedCandidate.id,
          candidateType: seedCandidate.type,
          assetPath,
        });
        return notFound(req.id, "Experience candidate not found.");
      }
      const requestedSourceCandidateIds = readOptionalStringArray(params, "sourceCandidateIds");
      const markSourcesConsumed = readOptionalBoolean(params, "markSourcesConsumed") === true;
      const requestedPreviewItems = requestedSourceCandidateIds.length > 0
        ? filterExperienceSynthesisPreviewItemsByCandidateIds(preview.items, requestedSourceCandidateIds)
        : preview.items;
      const maxSimilarSources = getExperienceSynthesisMaxSimilarSources();
      const selection = selectExperienceSynthesisPreviewItems(
        requestedPreviewItems,
        maxSimilarSources,
      );
      const orderedSourceCandidateIds = [
        seedCandidate.id,
        ...requestedPreviewItems.map((item) => item.candidateId),
      ];
      const limitedOrderedSourceCandidateIds = [
        seedCandidate.id,
        ...selection.selectedItems.map((item) => item.candidateId),
      ];
      if (orderedSourceCandidateIds.length > limitedOrderedSourceCandidateIds.length) {
        logWarn("Experience synthesis source candidates were truncated to the per-run limit", {
          candidateId: seedCandidate.id,
          candidateType: seedCandidate.type,
          requestedSourceCount: requestedSourceCandidateIds.length,
          orderedSourceCount: orderedSourceCandidateIds.length,
          selectedSourceCount: limitedOrderedSourceCandidateIds.length,
          selectedSameFamilyCount: selection.selectedSameFamilyCount,
          selectedSimilarCount: selection.selectedSimilarCount,
          maxSimilarSources,
        });
      }
      const sourceCandidates = resolveExperienceSynthesisSourceCandidatesFromIds({
        manager,
        stateDir: ctx.stateDir,
        seedCandidate,
        orderedSourceCandidateIds: limitedOrderedSourceCandidateIds,
        allowPublishedSources,
      });
      const draftSourceCandidateIds = sourceCandidates
        .filter((item) => item.status === "draft")
        .map((item) => item.id);
      const publishedSourceCandidateIds = sourceCandidates
        .filter((item) => item.status === "published")
        .map((item) => item.id);
      logDebug("Experience synthesis create requested", {
        candidateId: seedCandidate.id,
        candidateType: seedCandidate.type,
        requestedSourceCount: requestedSourceCandidateIds.length,
        orderedSourceCount: orderedSourceCandidateIds.length,
        selectedSourceCount: limitedOrderedSourceCandidateIds.length,
        selectedSameFamilyCount: selection.selectedSameFamilyCount,
        selectedSimilarCount: selection.selectedSimilarCount,
        resolvedSourceCount: sourceCandidates.length,
        resolvedDraftSourceCount: draftSourceCandidateIds.length,
        resolvedPublishedSourceCount: publishedSourceCandidateIds.length,
        previewMatchedCount: preview.items.length,
      });
      if (!sourceCandidates.length) {
        logWarn("Experience synthesis create aborted because no draft source candidates were resolved", {
          candidateId: seedCandidate.id,
          candidateType: seedCandidate.type,
          assetPath,
          requestedSourceCandidateIds,
          orderedSourceCandidateIds,
        });
        return invalid(req.id, "No source candidates are available for synthesis.");
      }

      try {
        const template = await resolveExperienceSynthesisTemplate(ctx.stateDir, seedCandidate.type);
        const systemPrompt = buildExperienceSynthesisSystemPrompt(template.content);
        const userPrompt = buildExperienceSynthesisUserPrompt({
          templateId: template.id,
          seedCandidate,
          sourceCandidates,
        });
        const scaleWarning = buildExperienceSynthesisScaleWarning({
          requestedSourceCount: requestedSourceCandidateIds.length > 0
            ? requestedSourceCandidateIds.length
            : preview.items.length + 1,
          orderedSourceCount: limitedOrderedSourceCandidateIds.length,
          sourceCandidates,
          systemPrompt,
          userPrompt,
        });
        if (scaleWarning) {
          logWarn("Experience synthesis source set is large; model call may become unstable", {
            candidateId: seedCandidate.id,
            candidateType: seedCandidate.type,
            templateId: template.id,
            ...scaleWarning,
          });
        }
        logDebug("Calling primary model for experience synthesis", {
          candidateId: seedCandidate.id,
          candidateType: seedCandidate.type,
          sourceCount: sourceCandidates.length,
          templateId: template.id,
          systemPromptLength: systemPrompt.length,
          userPromptLength: userPrompt.length,
        });
        const modelResult = await callPrimaryModelForExperienceSynthesis({
          ctx,
          system: systemPrompt,
          user: userPrompt,
        });
        logDebug("Primary model returned experience synthesis output", {
          candidateId: seedCandidate.id,
          candidateType: seedCandidate.type,
          outputLength: modelResult.content.length,
          finishReason: modelResult.finishReason || "unknown",
          attemptCount: modelResult.attemptCount,
          retryApplied: modelResult.retryApplied,
        });
        const parsed = parseExperienceSynthesisModelOutput(modelResult.content, {
          finishReason: modelResult.finishReason,
        });
        const title = normalizeText(parsed.title) || readFirstMarkdownTitle(parsed.content) || seedCandidate.title;
        const summary = normalizeText(parsed.summary) || readExperienceSynthesisSummary(seedCandidate.type, parsed.content) || seedCandidate.summary;
        const slug = buildExperienceCandidateSlug(seedCandidate.type, {
          title,
          slug: normalizeText(parsed.slug),
          fallback: seedCandidate.sourceTaskSnapshot?.taskId || seedCandidate.taskId,
          objective: seedCandidate.sourceTaskSnapshot?.objective,
          summary,
        });
        const validationIssues = seedCandidate.type === "method"
          ? validateMethodCandidateDraftForPublish(parsed.content)
          : validateSkillCandidateDraftForPublish(parsed.content);
        if (validationIssues.length > 0) {
          logWarn("Synthesized experience draft failed validation", {
            candidateId: seedCandidate.id,
            candidateType: seedCandidate.type,
            sourceCount: sourceCandidates.length,
            validationIssues,
          });
          return invalid(req.id, `Synthesized ${seedCandidate.type} draft failed validation: ${validationIssues.join("；")}`);
        }

        const createdCandidate = manager.createSynthesizedExperienceCandidate({
          seedCandidate,
          sourceCandidates,
          title,
          slug,
          summary,
          content: parsed.content,
          metadata: {
            draftOrigin: {
              kind: "synthesized",
            },
            synthesis: {
              seedCandidateId: seedCandidate.id,
              sourceCandidateIds: sourceCandidates.map((item) => item.id),
              sourceCount: sourceCandidates.length,
              createdBy: "main_model",
              templateId: template.id,
              templatePath: template.path ?? undefined,
              seedPublishedPath: seedCandidate.metadata?.publishedOrigin?.assetPath,
              seedPublishedAssetKey: seedCandidate.metadata?.publishedOrigin?.assetKey,
              seedPublishedAssetSource: seedCandidate.metadata?.publishedOrigin?.assetSource,
            },
          },
        });
        const consumedSourceCandidates = markSourcesConsumed
          ? manager.markExperienceCandidatesSynthesisConsumed({
            candidateIds: draftSourceCandidateIds,
            consumedByCandidateId: createdCandidate.id,
          })
          : [];
        logDebug("Experience synthesis draft created", {
          candidateId: seedCandidate.id,
          createdCandidateId: createdCandidate.id,
          candidateType: seedCandidate.type,
          sourceCount: sourceCandidates.length,
          templateId: template.id,
          consumedSourceCount: consumedSourceCandidates.length,
          markSourcesConsumed,
        });
        const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);
        return ok(req.id, {
          candidate: attachSkillFreshnessToCandidatePayload(
            toExperienceCandidatePayloadItem(createdCandidate, residentPolicy),
            createdCandidate,
            skillFreshnessSnapshot,
          ),
          created: true,
          sourceCount: sourceCandidates.length,
          sourceCandidateIds: sourceCandidates.map((item) => item.id),
          consumedSourceCount: consumedSourceCandidates.length,
          consumedSourceCandidateIds: consumedSourceCandidates.map((item) => item.id),
          markSourcesConsumed,
          templateInfo: {
            id: template.id,
            path: template.path,
          },
          queryView: buildResidentMemoryQueryView(residentPolicy),
        });
      } catch (error) {
        const recoverableMessage = resolveRecoverableExperienceSynthesisErrorMessage(error);
        logError("Experience synthesis create failed", {
          candidateId: seedCandidate.id,
          candidateType: seedCandidate.type,
          sourceCount: sourceCandidates.length,
          requestedSourceCount: requestedSourceCandidateIds.length,
          error: summarizeExperienceSynthesisError(error),
        });
        if (recoverableMessage) {
          return invalid(req.id, recoverableMessage);
        }
        throw error;
      }
    }

    case "experience.usage.get": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const usageId = readRequiredString(params, "usageId");
      if (!usageId) return invalid(req.id, "usageId is required");

      const usage = manager.getExperienceUsage(usageId);
      if (!usage) return notFound(req.id, "Experience usage not found.");
      const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);

      return ok(req.id, {
        usage: attachSkillFreshnessToUsagePayload(
          toExperienceUsagePayloadItem(manager, usage, residentPolicy),
          usage,
          skillFreshnessSnapshot,
        ),
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.usage.list": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 50);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = manager.listExperienceUsages(limit, filter as any);
      const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);
      return ok(req.id, {
        items: items.map((item) => attachSkillFreshnessToUsagePayload(
          toExperienceUsagePayloadItem(manager, item, residentPolicy),
          item,
          skillFreshnessSnapshot,
        )),
        limit,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.usage.stats": {
      const manager = resolveScopedMemoryManager(params);
      const residentPolicy = resolveScopedResidentMemoryPolicy(params, ctx.residentMemoryManagers);
      if (!manager) return notAvailable(req.id);

      const limit = clampListLimit(params.limit, 50);
      const filter = isObjectRecord(params.filter) ? params.filter : undefined;
      const items = manager.listExperienceUsageStats(limit, filter as any);
      const skillFreshnessSnapshot = await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager);
      return ok(req.id, {
        items: items.map((item) => attachSkillFreshnessToUsagePayload(
          toExperienceUsagePayloadItem(manager, item, residentPolicy),
          item,
          skillFreshnessSnapshot,
        )),
        limit,
        queryView: buildResidentMemoryQueryView(residentPolicy),
      });
    }

    case "experience.usage.revoke": {
      const manager = resolveScopedMemoryManager(params);
      if (!manager) return notAvailable(req.id);

      const usageId = readOptionalString(params, "usageId") ?? "";
      const taskId = readOptionalString(params, "taskId") ?? "";
      const assetType = readOptionalString(params, "assetType") ?? "";
      const assetKey = readOptionalString(params, "assetKey") ?? "";
      if (!usageId && (!taskId || (assetType !== "method" && assetType !== "skill") || !assetKey)) {
        return invalid(req.id, "usageId or taskId + assetType + assetKey is required.");
      }

      const usage = manager.revokeExperienceUsage({
        usageId: usageId || undefined,
        taskId: taskId || undefined,
        assetType: assetType === "method" || assetType === "skill" ? assetType : undefined,
        assetKey: assetKey || undefined,
      });

      return ok(req.id, { usage, revoked: Boolean(usage) });
    }

    case "experience.skill.freshness.update": {
      const manager = resolveScopedMemoryManager(params);
      const sourceCandidateId = readOptionalString(params, "sourceCandidateId") ?? "";
      const stale = params.stale !== false;
      const candidate = sourceCandidateId && manager ? manager.getExperienceCandidate(sourceCandidateId) : null;
      if (candidate && candidate.type !== "skill") {
        return invalid(req.id, "sourceCandidateId must point to a skill candidate.");
      }

      const skillKey = readOptionalString(params, "skillKey")
        ?? candidate?.title
        ?? candidate?.slug
        ?? "";
      if (!skillKey && !sourceCandidateId) {
        return invalid(req.id, "skillKey or sourceCandidateId is required.");
      }

      const updated = await updateSkillFreshnessManualMark(ctx.stateDir, {
        skillKey,
        sourceCandidateId: sourceCandidateId || undefined,
        reason: readOptionalString(params, "reason"),
        markedBy: readOptionalString(params, "markedBy") ?? extractScopedMemoryAgentId(params),
        stale,
      });
      const skillFreshnessSnapshot = manager
        ? await buildScopedSkillFreshnessSnapshot(ctx.stateDir, manager)
        : undefined;
      const skillFreshness = candidate
        ? findSkillFreshnessForCandidate(skillFreshnessSnapshot, candidate)
        : skillKey
          ? skillFreshnessSnapshot?.bySkillKey?.[skillKey.toLowerCase()]
          : undefined;

      return ok(req.id, {
        stale,
        mark: updated.mark,
        skillFreshness,
      });
    }

    default:
      return null;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readInventoryGovernanceSummary(
  value: unknown,
  report: Parameters<typeof buildMemorySourceInventoryGovernanceSummary>[0],
): MemorySourceInventoryGovernanceSummary {
  if (
    isObjectRecord(value)
    && typeof value.headline === "string"
    && typeof value.sourceKinds === "number"
    && typeof value.presentSourceKinds === "number"
    && typeof value.sourceFamilyCount === "number"
    && Array.isArray(value.topHighRiskFamilies)
    && Array.isArray(value.topSuggestedFamilies)
  ) {
    return value as MemorySourceInventoryGovernanceSummary;
  }
  return buildMemorySourceInventoryGovernanceSummary(report);
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  return typeof params[key] === "string" ? params[key].trim() : "";
}

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = readRequiredString(params, key);
  return value || undefined;
}

function readOptionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const raw = params[key];
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  }
  return undefined;
}

function readOptionalStringArray(params: Record<string, unknown>, key: string): string[] {
  const raw = params[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

async function resolveConfiguredInventorySources(
  params: Record<string, unknown>,
  stateDir: string,
  options: {
    singleSourceMessage?: string;
  } = {},
): Promise<{ sources: MemorySourceInventoryConfiguredSource[] } | { error: string }> {
  let sources: MemorySourceInventoryConfiguredSource[];
  if (params.configuredSources != null) {
    const normalized = normalizeConfiguredMemorySourcesInput(params.configuredSources, "configuredSources");
    if ("error" in normalized) {
      return { error: normalized.error };
    }
    sources = normalized.sources;
  } else {
    try {
      const store = await readConfiguredMemorySourcesStore(stateDir);
      sources = store.sources;
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const configuredSourceId = readOptionalString(params, "configuredSourceId");
  if (configuredSourceId) {
    const matched = sources.filter((item) => item.id === configuredSourceId);
    if (matched.length <= 0) {
      return { error: `configuredSourceId not found: ${configuredSourceId}` };
    }
    sources = matched;
  }

  if (options.singleSourceMessage && sources.length !== 1) {
    return { error: options.singleSourceMessage };
  }

  return { sources };
}

function isMemoryTreeReportReviewDecision(value: string | undefined): value is "approved" | "rejected" | "superseded" {
  return value === "approved"
    || value === "rejected"
    || value === "superseded";
}

function isMemoryTreeNodeKind(
  value: string | undefined,
): value is "task" | "conversation" | "day" | "topic" | "project" | "agent" | "profile" | "global" {
  return value === "task"
    || value === "conversation"
    || value === "day"
    || value === "topic"
    || value === "project"
    || value === "agent"
    || value === "profile"
    || value === "global";
}

function isManagedMemoryTreeNodeKind(
  value: string | undefined,
): value is "topic" | "profile" | "global" {
  return value === "topic"
    || value === "profile"
    || value === "global";
}

function readManagedMemoryTreeNodeKinds(
  params: Record<string, unknown>,
  key: string,
): Array<"topic" | "profile" | "global"> | null | undefined {
  if (!(key in params)) {
    return undefined;
  }
  const values = readOptionalStringArray(params, key);
  if (values.length <= 0) {
    return [];
  }
  if (values.some((value) => !isManagedMemoryTreeNodeKind(value))) {
    return null;
  }
  return values as Array<"topic" | "profile" | "global">;
}

function readOptionalNonNegativeInteger(params: Record<string, unknown>, key: string): number | undefined {
  const raw = params[key];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dedupeStrings(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function readPositiveIntegerEnv(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized >= minimum ? normalized : fallback;
}

function getExperienceSynthesisMaxSimilarSources(): number {
  return readPositiveIntegerEnv(
    EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES_ENV,
    DEFAULT_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES,
  );
}

function getExperienceSynthesisMaxSourceContentChars(): number {
  return readPositiveIntegerEnv(
    EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS_ENV,
    DEFAULT_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS,
    200,
  );
}

function getExperienceSynthesisTotalSourceContentCharBudget(): number {
  return readPositiveIntegerEnv(
    EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET_ENV,
    DEFAULT_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET,
    1_000,
  );
}

function confirmationRequired(id: string, message: string): GatewayResFrame {
  return {
    type: "res",
    id,
    ok: false,
    error: {
      code: "confirmation_required",
      message,
    },
  };
}

function readEnvBoolean(name: string): boolean {
  const normalized = String(process.env[name] ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function isExperienceGenerationConfirmationRequired(type: "method" | "skill"): boolean {
  return type === "method"
    ? readEnvBoolean("BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED")
    : readEnvBoolean("BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED");
}

function isExperiencePublishConfirmationRequired(type: "method" | "skill"): boolean {
  return type === "method"
    ? readEnvBoolean("BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED")
    : readEnvBoolean("BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED");
}

function clampListLimit(value: unknown, fallback: number, max = 100): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function extractScopedMemoryAgentId(params: Record<string, unknown>): string | undefined {
  if (typeof params.agentId === "string" && params.agentId.trim()) {
    return params.agentId.trim();
  }
  if (typeof params.conversationId === "string" && params.conversationId.trim()) {
    return undefined;
  }
  const filter = isObjectRecord(params.filter) ? params.filter : undefined;
  if (filter && typeof filter.agentId === "string" && filter.agentId.trim()) {
    return filter.agentId.trim();
  }
  return undefined;
}

function extractTargetMemoryAgentId(params: Record<string, unknown>): string | undefined {
  if (typeof params.targetAgentId === "string" && params.targetAgentId.trim()) {
    return params.targetAgentId.trim();
  }
  return extractScopedMemoryAgentId(params);
}

function extractReviewerMemoryAgentId(params: Record<string, unknown>): string | undefined {
  if (typeof params.reviewerAgentId === "string" && params.reviewerAgentId.trim()) {
    return params.reviewerAgentId.trim();
  }
  return extractScopedMemoryAgentId(params);
}

function resolveScopedMemoryManager(params: Record<string, unknown> = {}) {
  const conversationId = typeof params.conversationId === "string" && params.conversationId.trim()
    ? params.conversationId.trim()
    : undefined;
  const agentId = extractScopedMemoryAgentId(params);
  return getGlobalMemoryManager({
    agentId,
    conversationId,
  });
}

function resolveScopedTaskWorkSurface(params: Record<string, unknown> = {}) {
  const manager = resolveScopedMemoryManager(params);
  return manager ? createTaskWorkSurface(manager) : null;
}

function resolveScopedResidentMemoryPolicy(
  params: Record<string, unknown> = {},
  records: ScopedMemoryManagerRecord[] = [],
) {
  const agentId = extractScopedMemoryAgentId(params) ?? "default";
  return records.find((item) => item.agentId === agentId)?.policy
    ?? records.find((item) => item.agentId === "default")?.policy;
}

async function buildScopedSkillFreshnessSnapshot(
  stateDir: string,
  manager: ReturnType<typeof resolveScopedMemoryManager>,
) {
  return buildSkillFreshnessSnapshot({
    manager,
    stateDir,
  });
}

function attachSkillFreshnessToCandidatePayload(
  payload: Record<string, unknown>,
  candidate: any,
  snapshot?: Awaited<ReturnType<typeof buildSkillFreshnessSnapshot>>,
): Record<string, unknown> {
  const skillFreshness = candidate?.type === "skill" ? findSkillFreshnessForCandidate(snapshot, candidate) : undefined;
  return skillFreshness ? { ...payload, skillFreshness } : payload;
}

function attachSkillFreshnessToUsagePayload(
  payload: Record<string, unknown>,
  item: any,
  snapshot?: Awaited<ReturnType<typeof buildSkillFreshnessSnapshot>>,
): Record<string, unknown> {
  const skillFreshness = item?.assetType === "skill" ? findSkillFreshnessForUsage(snapshot, item) : undefined;
  return skillFreshness ? { ...payload, skillFreshness } : payload;
}

function resolveResidentMemoryManagerRecord(
  agentId: string | undefined,
  records: ScopedMemoryManagerRecord[] = [],
): ScopedMemoryManagerRecord | undefined {
  const normalizedAgentId = typeof agentId === "string" && agentId.trim()
    ? agentId.trim()
    : "default";
  return records.find((item) => item.agentId === normalizedAgentId)
    ?? records.find((item) => item.agentId === "default");
}

function buildSharedGovernanceCounts(
  manager: ReturnType<typeof resolveScopedMemoryManager>,
  residentPolicy?: ScopedMemoryManagerRecord["policy"],
): {
  pendingCount: number;
  claimedCount: number;
  approvedCount: number;
  rejectedCount: number;
  revokedCount: number;
  noneCount: number;
} {
  if (!manager || residentPolicy?.writeTarget === "shared") {
    return {
      pendingCount: 0,
      claimedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      revokedCount: 0,
      noneCount: 0,
    };
  }

  return {
    pendingCount: manager.countChunks({ sharedPromotionStatus: "pending" }),
    claimedCount: manager.countChunks({ sharedPromotionStatus: "pending", sharedPromotionClaimed: true }),
    approvedCount: manager.countChunks({ sharedPromotionStatus: "approved" }),
    rejectedCount: manager.countChunks({ sharedPromotionStatus: "rejected" }),
    revokedCount: manager.countChunks({ sharedPromotionStatus: "revoked" }),
    noneCount: manager.countChunks({ sharedPromotionStatus: "none" }),
  };
}

function toMemoryListPayloadItems(
  items: Array<any>,
  includeContent: boolean,
  residentPolicy?: ScopedMemoryManagerRecord["policy"],
): Array<Record<string, unknown>> {
  const withSourceView = attachResidentMemorySourceViews(items, residentPolicy);
  if (includeContent) {
    return withSourceView as Array<Record<string, unknown>>;
  }
  return withSourceView.map((item) => {
    const { content, ...rest } = item;
    return rest;
  });
}

function toExperienceCandidatePayloadItem(
  item: any,
  residentPolicy?: ScopedMemoryManagerRecord["policy"],
): Record<string, unknown> {
  return attachResidentExperienceCandidateSourceView(item, residentPolicy) as unknown as Record<string, unknown>;
}

function toPublishedExperienceAssetPayloadItem(item: {
  source: string;
  type: ExperienceCandidateType;
  key: string;
  title?: string;
  summary?: string;
  publishedPath: string;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    source: item.source,
    type: item.type,
    key: item.key,
    ...(item.title ? { title: item.title } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    publishedPath: item.publishedPath,
    ...(item.metadata ? { metadata: item.metadata } : {}),
  };
}

function toPublishedExperienceAssetDetailPayloadItem(item: PublishedExperienceAssetRecord): Record<string, unknown> {
  return {
    ...toPublishedExperienceAssetPayloadItem(item),
    content: item.content,
  };
}

function normalizePublishedAssetType(value: string): ExperienceCandidateType | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "method" || normalized === "skill") {
    return normalized;
  }
  return undefined;
}

function comparePublishedAssetRecords(
  left: { type: ExperienceCandidateType; title?: string; key: string; publishedPath: string },
  right: { type: ExperienceCandidateType; title?: string; key: string; publishedPath: string },
): number {
  if (left.type !== right.type) {
    return left.type.localeCompare(right.type);
  }
  const leftLabel = String(left.title || left.key || left.publishedPath).trim();
  const rightLabel = String(right.title || right.key || right.publishedPath).trim();
  return leftLabel.localeCompare(rightLabel);
}

function resolveVirtualPublishedSeedCandidate(
  stateDir: string,
  assetPath: string,
): ExperienceCandidate | null {
  const matched = findPublishedAssetRecordByPath(stateDir, assetPath);
  return matched ? buildVirtualCandidateFromPublishedAsset({ asset: matched }) : null;
}

function findPublishedAssetRecordByPath(
  stateDir: string,
  assetPath: string,
): PublishedExperienceAssetRecord | null {
  const normalizedAssetPath = path.resolve(assetPath);
  const assets = listPublishedAssets(stateDir);
  return assets.find((item) => path.resolve(item.publishedPath) === normalizedAssetPath) || null;
}

function getPublishedAssetPathValidationError(stateDir: string, assetPath: string): string {
  const normalizedAssetPath = path.resolve(assetPath);
  const methodsDir = path.resolve(path.join(stateDir, "methods"));
  const skillsDir = path.resolve(path.join(stateDir, "skills"));
  if (normalizedAssetPath === methodsDir || normalizedAssetPath === skillsDir) {
    return "assetPath must point to a published method .md file or skill SKILL.md file, not the methods/skills directory.";
  }
  const relativeToMethods = path.relative(methodsDir, normalizedAssetPath);
  if (!relativeToMethods.startsWith("..") && !path.isAbsolute(relativeToMethods)) {
    if (path.extname(normalizedAssetPath).toLowerCase() !== ".md") {
      return "assetPath must point to a published method .md file.";
    }
    return "";
  }
  const relativeToSkills = path.relative(skillsDir, normalizedAssetPath);
  if (!relativeToSkills.startsWith("..") && !path.isAbsolute(relativeToSkills)) {
    if (path.basename(normalizedAssetPath).toUpperCase() !== "SKILL.MD") {
      return "assetPath must point to a published skill SKILL.md file.";
    }
    return "";
  }
  return "assetPath must point to a published method .md file or skill SKILL.md file.";
}

function getPublishedAssetPublishTargetValidationError(
  stateDir: string,
  candidateType: ExperienceCandidateType,
  publishTargetPath: string,
): string {
  const normalizedTargetPath = path.resolve(publishTargetPath);
  const methodsDir = path.resolve(path.join(stateDir, "methods"));
  const skillsDir = path.resolve(path.join(stateDir, "skills"));
  if (candidateType === "method") {
    const relative = path.relative(methodsDir, normalizedTargetPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return "publishTargetPath for a method candidate must stay under stateDir/methods.";
    }
    if (path.extname(normalizedTargetPath).toLowerCase() !== ".md") {
      return "publishTargetPath for a method candidate must point to a .md file.";
    }
    return "";
  }
  const relative = path.relative(skillsDir, normalizedTargetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "publishTargetPath for a skill candidate must stay under stateDir/skills.";
  }
  if (path.basename(normalizedTargetPath).toUpperCase() !== "SKILL.MD") {
    return "publishTargetPath for a skill candidate must point to SKILL.md.";
  }
  return "";
}

function listExperienceSynthesisSourceCandidates(
  manager: NonNullable<ReturnType<typeof resolveScopedMemoryManager>>,
  stateDir: string,
  seedCandidate: ExperienceCandidate,
): ExperienceCandidate[] {
  const storedDraftCandidates = manager.listExperienceCandidates(1000, {
    type: seedCandidate.type,
    status: "draft",
    synthesisConsumed: false,
  });
  const publishedVirtualCandidates = listPublishedAssets(stateDir, seedCandidate.type)
    .map((asset) => buildVirtualCandidateFromPublishedAsset({ asset }))
    .filter((item) =>
      item.id !== seedCandidate.id
      && item.publishedPath !== seedCandidate.publishedPath,
    );
  return [...storedDraftCandidates, ...publishedVirtualCandidates];
}

function buildVirtualCandidateSynthesisPreview(
  manager: NonNullable<ReturnType<typeof resolveScopedMemoryManager>>,
  stateDir: string,
  seedCandidate: ExperienceCandidate,
  limit: number,
) {
  return buildExperienceSynthesisPreviewFromSourceCandidates(
    seedCandidate,
    listExperienceSynthesisSourceCandidates(manager, stateDir, seedCandidate),
    { limit },
  );
}

function resolveExperienceSynthesisSourceCandidatesFromIds(input: {
  manager: NonNullable<ReturnType<typeof resolveScopedMemoryManager>>;
  stateDir: string;
  seedCandidate: ExperienceCandidate;
  orderedSourceCandidateIds: string[];
  allowPublishedSources: boolean;
}): ExperienceCandidate[] {
  const candidateById = new Map<string, ExperienceCandidate>();
  candidateById.set(input.seedCandidate.id, input.seedCandidate);
  for (const candidate of listExperienceSynthesisSourceCandidates(input.manager, input.stateDir, input.seedCandidate)) {
    if (!candidateById.has(candidate.id)) {
      candidateById.set(candidate.id, candidate);
    }
  }
  const resolvedCandidates: ExperienceCandidate[] = [];
  const seen = new Set<string>();
  for (const candidateId of input.orderedSourceCandidateIds) {
    if (seen.has(candidateId)) {
      continue;
    }
    seen.add(candidateId);
    const candidate = candidateById.get(candidateId);
    if (!candidate || candidate.type !== input.seedCandidate.type) {
      continue;
    }
    if (candidate.status === "draft") {
      resolvedCandidates.push(candidate);
      continue;
    }
    if (input.allowPublishedSources && candidate.status === "published") {
      resolvedCandidates.push(candidate);
    }
  }
  return resolvedCandidates;
}

function toExperienceUsagePayloadItem(
  manager: ReturnType<typeof resolveScopedMemoryManager>,
  item: any,
  residentPolicy?: ScopedMemoryManagerRecord["policy"],
): Record<string, unknown> {
  const sourceCandidate = item?.sourceCandidateId && manager
    ? manager.getExperienceCandidate(String(item.sourceCandidateId))
    : null;
  return attachResidentExperienceUsageSourceView(item, sourceCandidate, residentPolicy) as unknown as Record<string, unknown>;
}

function toTaskExperiencePayloadItem(
  manager: ReturnType<typeof resolveScopedMemoryManager>,
  item: any,
  residentPolicy?: ScopedMemoryManagerRecord["policy"],
): Record<string, unknown> {
  return attachResidentTaskExperienceSourceView(item, {
    policy: residentPolicy,
    resolveCandidate: (candidateId) => manager?.getExperienceCandidate(candidateId) ?? null,
  }) as unknown as Record<string, unknown>;
}

function toTaskListPayloadItems(items: Array<any>, summaryOnly: boolean): Array<Record<string, unknown>> {
  if (!summaryOnly) {
    return items as Array<Record<string, unknown>>;
  }
  return items.map((item) => ({
    id: item.id,
    conversationId: item.conversationId,
    title: item.title,
    objective: item.objective,
    summary: item.summary,
    status: item.status,
    source: item.source,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    createdAt: item.createdAt,
    metadata: item.metadata,
  }));
}

function buildExperienceSynthesisSystemPrompt(templateContent: string): string {
  return [
    "你是经验能力合成器。",
    "你的任务是阅读多个相似的经验草稿，综合生成一个新的高质量 draft 候选。",
    "严格遵守模板中的结构、约束、章节与质量要求。",
    "不要输出解释，不要输出额外 prose，只返回一个 JSON 对象。",
    'JSON 结构必须是 {"title":"...","summary":"...","content":"完整 markdown"}。',
    "",
    "以下是合成模板：",
    templateContent.trim(),
  ].join("\n");
}

function filterExperienceSynthesisPreviewItemsByCandidateIds(
  items: ExperienceSynthesisPreviewItem[],
  candidateIds: string[],
): ExperienceSynthesisPreviewItem[] {
  const requestedIds = new Set(dedupeStrings(candidateIds));
  if (!requestedIds.size) {
    return Array.isArray(items) ? [...items] : [];
  }
  return (Array.isArray(items) ? items : []).filter((item) => requestedIds.has(String(item?.candidateId ?? "")));
}

export function selectExperienceSynthesisPreviewItems(
  items: ExperienceSynthesisPreviewItem[],
  maxCount: number,
): {
  selectedItems: ExperienceSynthesisPreviewItem[];
  sameFamilyCount: number;
  similarCount: number;
  selectedSameFamilyCount: number;
  selectedSimilarCount: number;
} {
  const normalizedMaxCount = Number.isInteger(maxCount) && maxCount > 0 ? maxCount : getExperienceSynthesisMaxSimilarSources();
  const sameFamilyItems: ExperienceSynthesisPreviewItem[] = [];
  const similarItems: ExperienceSynthesisPreviewItem[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const relation = normalizeText(item?.relation).toLowerCase();
    if (relation === "same_family") {
      sameFamilyItems.push(item);
      continue;
    }
    similarItems.push(item);
  }
  const selectedSameFamilyItems = sameFamilyItems.slice(0, normalizedMaxCount);
  const selectedSimilarItems = similarItems.slice(0, Math.max(0, normalizedMaxCount - selectedSameFamilyItems.length));
  return {
    selectedItems: [...selectedSameFamilyItems, ...selectedSimilarItems],
    sameFamilyCount: sameFamilyItems.length,
    similarCount: similarItems.length,
    selectedSameFamilyCount: selectedSameFamilyItems.length,
    selectedSimilarCount: selectedSimilarItems.length,
  };
}

function buildExperienceSynthesisUserPrompt(input: {
  templateId: string;
  seedCandidate: ExperienceCandidate;
  sourceCandidates: ExperienceCandidate[];
}): string {
  const sourcePayloadInfo = buildExperienceSynthesisSourcePayload(input.sourceCandidates);
  const sourcePayload = sourcePayloadInfo.text;

  return [
    `candidateType: ${input.seedCandidate.type}`,
    `templateId: ${input.templateId}`,
    `seedCandidateId: ${input.seedCandidate.id}`,
    `seedCandidateTitle: ${input.seedCandidate.title}`,
    `sourceCount: ${input.sourceCandidates.length}`,
    `sourceContentBudget: ${sourcePayloadInfo.totalBudget}`,
    `sourceContentCharsUsed: ${sourcePayloadInfo.usedChars}`,
    "",
    "要求：",
    "1. 生成一个新的、更完整的 draft，而不是拼接原文。",
    "2. 优先保留多个草稿反复出现的稳定共性。",
    "3. 如果不同草稿存在冲突，输出更稳妥、更通用、边界更清晰的版本。",
    "4. content 必须是完整 markdown，并满足后续 publish 校验。",
    "5. title / summary / content 三个字段都必须填写。",
    "",
    sourcePayload,
  ].join("\n");
}

function buildExperienceSynthesisSourcePayload(sourceCandidates: ExperienceCandidate[]): {
  text: string;
  usedChars: number;
  totalBudget: number;
} {
  const candidates = Array.isArray(sourceCandidates) ? sourceCandidates : [];
  if (!candidates.length) {
    return {
      text: "",
      usedChars: 0,
      totalBudget: getExperienceSynthesisTotalSourceContentCharBudget(),
    };
  }

  const totalBudget = getExperienceSynthesisTotalSourceContentCharBudget();
  const perCandidateMaxChars = getExperienceSynthesisMaxSourceContentChars();
  const perCandidateContentLimit = Math.min(
    perCandidateMaxChars,
    Math.max(600, Math.floor(totalBudget / candidates.length)),
  );
  let usedChars = 0;
  const sections = candidates.map((candidate, index) => {
    const snapshot = candidate.sourceTaskSnapshot && typeof candidate.sourceTaskSnapshot === "object"
      ? candidate.sourceTaskSnapshot as unknown as Record<string, unknown>
      : {};
    const toolCalls = Array.isArray(snapshot.toolCalls) ? snapshot.toolCalls : [];
    const toolNames = toolCalls.length > 0
      ? toolCalls.map((item) => normalizeText((item as { toolName?: unknown } | null | undefined)?.toolName)).filter(Boolean)
      : [];
    const contentExcerpt = truncateText(candidate.content, perCandidateContentLimit);
    usedChars += contentExcerpt.length;
    return [
      `## Source ${index + 1}`,
      `- candidateId: ${candidate.id}`,
      `- type: ${candidate.type}`,
      `- taskId: ${candidate.taskId}`,
      `- sourceTaskId: ${normalizeText(snapshot.taskId) || candidate.taskId}`,
      `- title: ${candidate.title}`,
      `- slug: ${candidate.slug}`,
      `- summary: ${candidate.summary || "-"}`,
      `- objective: ${normalizeText(snapshot.objective) || "-"}`,
      `- taskSummary: ${normalizeText(snapshot.summary) || "-"}`,
      `- reflection: ${normalizeText(snapshot.reflection) || "-"}`,
      `- outcome: ${normalizeText(snapshot.outcome) || "-"}`,
      `- tools: ${toolNames.join(", ") || "-"}`,
      "",
      "### Draft Content",
      contentExcerpt,
    ].join("\n");
  }).join("\n\n");

  return {
    text: sections,
    usedChars,
    totalBudget,
  };
}

const EXPERIENCE_SYNTHESIS_LARGE_SOURCE_COUNT_WARN_THRESHOLD = 12;
const EXPERIENCE_SYNTHESIS_LARGE_PROMPT_CHAR_WARN_THRESHOLD = 28_000;

function buildExperienceSynthesisScaleWarning(input: {
  requestedSourceCount: number;
  orderedSourceCount: number;
  sourceCandidates: ExperienceCandidate[];
  systemPrompt: string;
  userPrompt: string;
}): Record<string, unknown> | null {
  const requestedSourceCount = input.requestedSourceCount;
  const orderedSourceCount = input.orderedSourceCount;
  const sourceCount = input.sourceCandidates.length;
  const systemPromptLength = input.systemPrompt.length;
  const userPromptLength = input.userPrompt.length;
  const promptLength = systemPromptLength + userPromptLength;
  const sourcePayloadInfo = buildExperienceSynthesisSourcePayload(input.sourceCandidates);
  const reasons: string[] = [];
  if (requestedSourceCount >= EXPERIENCE_SYNTHESIS_LARGE_SOURCE_COUNT_WARN_THRESHOLD) {
    reasons.push(`requestedSourceCount>=${EXPERIENCE_SYNTHESIS_LARGE_SOURCE_COUNT_WARN_THRESHOLD}`);
  }
  if (orderedSourceCount >= EXPERIENCE_SYNTHESIS_LARGE_SOURCE_COUNT_WARN_THRESHOLD) {
    reasons.push(`orderedSourceCount>=${EXPERIENCE_SYNTHESIS_LARGE_SOURCE_COUNT_WARN_THRESHOLD}`);
  }
  if (sourceCount >= EXPERIENCE_SYNTHESIS_LARGE_SOURCE_COUNT_WARN_THRESHOLD) {
    reasons.push(`sourceCount>=${EXPERIENCE_SYNTHESIS_LARGE_SOURCE_COUNT_WARN_THRESHOLD}`);
  }
  if (promptLength >= EXPERIENCE_SYNTHESIS_LARGE_PROMPT_CHAR_WARN_THRESHOLD) {
    reasons.push(`promptLength>=${EXPERIENCE_SYNTHESIS_LARGE_PROMPT_CHAR_WARN_THRESHOLD}`);
  }
  if (!reasons.length) {
    return null;
  }
  return {
    reason: reasons.join(", "),
    requestedSourceCount,
    orderedSourceCount,
    sourceCount,
    systemPromptLength,
    userPromptLength,
    promptLength,
    sourceContentBudget: sourcePayloadInfo.totalBudget,
    sourceContentCharsUsed: sourcePayloadInfo.usedChars,
    candidateIdsSample: input.sourceCandidates.slice(0, 8).map((candidate) => candidate.id),
  };
}

async function callPrimaryModelForExperienceSynthesis(input: {
  ctx: MemoryExperienceMethodContext;
  system: string;
  user: string;
}): Promise<{ content: string; finishReason: string; attemptCount: number; retryApplied: boolean }> {
  const initialConfig = resolveExperienceSynthesisModelRequestConfig(input.ctx);
  try {
    const result = await invokePrimaryModelForExperienceSynthesis({
      ctx: input.ctx,
      system: input.system,
      user: input.user,
      config: initialConfig,
    });
    return {
      ...result,
      attemptCount: 1,
      retryApplied: false,
    };
  } catch (error) {
    const retryConfig = shouldRetryExperienceSynthesisWithReducedReasoning(error)
      ? buildExperienceSynthesisReducedReasoningRetryConfig(initialConfig)
      : null;
    if (!retryConfig) {
      throw error;
    }
    input.ctx.logger?.warn?.("Experience synthesis model exhausted output budget; retrying with reduced reasoning", {
      initialReasoningEffort: initialConfig.reasoningEffort || "",
      retryReasoningEffort: retryConfig.reasoningEffort || "",
      clearedThinking: Boolean(initialConfig.thinking),
      model: retryConfig.model || initialConfig.model || "",
    });
    const retried = await invokePrimaryModelForExperienceSynthesis({
      ctx: input.ctx,
      system: input.system,
      user: input.user,
      config: retryConfig,
    });
    return {
      ...retried,
      attemptCount: 2,
      retryApplied: true,
    };
  }
}

async function invokePrimaryModelForExperienceSynthesis(input: {
  ctx: MemoryExperienceMethodContext;
  system: string;
  user: string;
  config: ExperienceSynthesisModelRequestConfig;
}): Promise<{ content: string; finishReason: string }> {
  if (typeof input.ctx.callPrimaryModel === "function") {
    const content = await input.ctx.callPrimaryModel({
      system: input.system,
      user: input.user,
      maxTokens: 8_000,
      model: input.config.model,
      thinking: input.config.thinking,
      reasoningEffort: input.config.reasoningEffort,
    });
    return {
      content,
      finishReason: "",
    };
  }

  const config = input.ctx.primaryModelConfig;
  const requestConfig = {
    baseUrl: config?.baseUrl,
    apiKey: config?.apiKey,
    model: input.config.model,
    thinking: input.config.thinking,
    reasoningEffort: input.config.reasoningEffort,
  };
  if (!requestConfig.baseUrl || !requestConfig.apiKey || !requestConfig.model) {
    throw new Error("Primary model is not configured for experience synthesis.");
  }

  const payload: Record<string, unknown> = {
    model: requestConfig.model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    temperature: 0.2,
    max_tokens: 8_000,
  };
  if (requestConfig.thinking) {
    payload.thinking = requestConfig.thinking;
  }
  if (requestConfig.reasoningEffort) {
    payload.reasoning_effort = requestConfig.reasoningEffort;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Experience synthesis model call timed out after ${EXPERIENCE_SYNTHESIS_MODEL_CALL_TIMEOUT_MS}ms.`));
  }, EXPERIENCE_SYNTHESIS_MODEL_CALL_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(buildOpenAIChatCompletionsUrl(requestConfig.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requestConfig.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Experience synthesis model call timed out after ${EXPERIENCE_SYNTHESIS_MODEL_CALL_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Experience synthesis model call failed: ${response.status} ${truncateText(text, 200)}`.trim());
  }
  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string | null; type?: string | null }> | null;
        reasoning_content?: string | null;
      };
      finish_reason?: string | null;
    }>;
  };
  const choice = data.choices?.[0];
  const content = extractExperienceSynthesisResponseText(choice?.message?.content);
  const finishReason = normalizeText(choice?.finish_reason);
  if (!content) {
    const reasoningContent = normalizeText(choice?.message?.reasoning_content);
    throw new Error(
      `Experience synthesis model returned empty content. finish_reason=${finishReason || "unknown"}, reasoning_content=${reasoningContent ? `present(${reasoningContent.length})` : "absent"}.`,
    );
  }
  return {
    content,
    finishReason,
  };
}

function resolveExperienceSynthesisModelRequestConfig(
  ctx: MemoryExperienceMethodContext,
): ExperienceSynthesisModelRequestConfig {
  return {
    model: ctx.primaryModelConfig?.model,
    thinking: ctx.primaryModelConfig?.thinking,
    reasoningEffort: normalizeExperienceSynthesisReasoningEffort(ctx.primaryModelConfig?.reasoningEffort),
  };
}

function shouldRetryExperienceSynthesisWithReducedReasoning(error: unknown): boolean {
  const message = error instanceof Error ? normalizeText(error.message) : normalizeText(String(error));
  return Boolean(
    message
    && message.includes("Experience synthesis model returned empty content.")
    && message.includes("finish_reason=length"),
  );
}

function buildExperienceSynthesisReducedReasoningRetryConfig(
  current: ExperienceSynthesisModelRequestConfig,
): ExperienceSynthesisModelRequestConfig | null {
  const normalizedReasoningEffort = normalizeExperienceSynthesisReasoningEffort(current.reasoningEffort);
  const reducedReasoningEffort = reduceExperienceSynthesisReasoningEffort(normalizedReasoningEffort);
  const clearsThinking = Boolean(current.thinking);
  if (!reducedReasoningEffort && !normalizedReasoningEffort && !clearsThinking) {
    return null;
  }
  return {
    model: current.model,
    reasoningEffort: reducedReasoningEffort,
  };
}

function normalizeExperienceSynthesisReasoningEffort(value: unknown): string {
  return normalizeText(value)?.toLowerCase() || "";
}

function reduceExperienceSynthesisReasoningEffort(value: string): string {
  switch (value) {
    case "max":
      return "high";
    case "high":
      return "medium";
    case "medium":
      return "low";
    case "low":
      return "minimal";
    default:
      return "";
  }
}

function extractExperienceSynthesisResponseText(
  content: string | Array<{ text?: string | null; type?: string | null }> | null | undefined,
): string {
  if (typeof content === "string") {
    return normalizeText(content);
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (typeof part.text === "string" && part.text.trim()) {
      chunks.push(part.text.trim());
    }
  }
  return normalizeText(chunks.join("\n"));
}

function parseExperienceSynthesisModelOutput(
  raw: string,
  options: { finishReason?: string | null } = {},
): { title: string; summary: string; slug: string; content: string } {
  const extracted = normalizeJsonCandidate(raw, options);
  const parsed = JSON.parse(extracted) as Record<string, unknown>;
  const title = normalizeText(parsed.title);
  const summary = normalizeText(parsed.summary);
  const slug = normalizeText(parsed.slug);
  const content = normalizeText(parsed.content);
  if (!content) {
    throw new Error("Synthesized candidate content is empty.");
  }
  return {
    title,
    summary,
    slug,
    content,
  };
}

function summarizeExperienceSynthesisError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: truncateText(error.stack || "", 1200),
    };
  }
  return {
    message: String(error),
  };
}

function resolveRecoverableExperienceSynthesisErrorMessage(error: unknown): string {
  const message = error instanceof Error ? normalizeText(error.message) : normalizeText(String(error));
  if (!message) {
    return "";
  }
  if (message.includes("Experience synthesis model returned empty content.")) {
    if (message.includes("finish_reason=length")) {
      return "Experience synthesis model exhausted its output budget before returning content. Try again, reduce source size, or lower reasoning depth.";
    }
    return "Experience synthesis model did not return usable content. Try again or switch to a less reasoning-heavy model.";
  }
  return "";
}

function normalizeJsonCandidate(raw: string, options: { finishReason?: string | null } = {}): string {
  const direct = stripMarkdownFence(stripReasoningArtifacts(raw));
  if (direct.startsWith("{") && direct.endsWith("}")) {
    return direct;
  }

  const extracted = extractFirstJsonObject(direct);
  if (extracted) {
    return extracted;
  }

  const repaired = repairIncompleteJsonObjectCandidate(direct);
  if (repaired) {
    return repaired;
  }

  const finishReason = normalizeText(options.finishReason);
  const likelyTruncated = isLikelyTruncatedJsonCandidate(direct);
  const diagnostics = [
    finishReason ? `finish_reason=${finishReason}` : "",
    likelyTruncated ? "likely_truncated=true" : "",
  ].filter(Boolean).join(", ");
  const suffix = diagnostics ? ` (${diagnostics})` : "";
  throw new Error(`Model did not return a valid JSON object${suffix}. Preview: ${truncateText(raw, 160)}`);
}

function stripMarkdownFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function stripReasoningArtifacts(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .trim();
}

function extractFirstJsonObject(value: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (start < 0) {
      if (char === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function repairIncompleteJsonObjectCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  const repairPlan = analyzeJsonClosure(trimmed);
  if (repairPlan.depth <= 0 && !repairPlan.inString) {
    return null;
  }
  const repaired = `${trimmed}${"\"".repeat(repairPlan.inString ? 1 : 0)}${"]".repeat(repairPlan.bracketDepth)}${"}".repeat(repairPlan.braceDepth)}`;
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

function isLikelyTruncatedJsonCandidate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  const repairPlan = analyzeJsonClosure(trimmed);
  return repairPlan.inString || repairPlan.depth > 0;
}

function analyzeJsonClosure(value: string): {
  depth: number;
  braceDepth: number;
  bracketDepth: number;
  inString: boolean;
} {
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }
  }

  return {
    depth: braceDepth + bracketDepth,
    braceDepth,
    bracketDepth,
    inString,
  };
}

function readExperienceSynthesisSummary(type: ExperienceCandidateType, content: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatterBody = frontmatter?.[1] || "";
  const preferredKey = type === "skill" ? "description" : "summary";
  const frontmatterValue = readFrontmatterValue(frontmatterBody, preferredKey)
    || readFrontmatterValue(frontmatterBody, "summary");
  if (frontmatterValue) {
    return frontmatterValue;
  }
  const blockquoteLine = content.match(/^>\s+(.+)$/m)?.[1]?.trim();
  if (blockquoteLine) {
    return blockquoteLine;
  }
  const paragraph = content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .split(/\r?\n\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#"));
  return paragraph || "";
}

function readFrontmatterValue(frontmatter: string, key: string): string {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.+)$`, "im");
  const match = frontmatter.match(pattern);
  if (!match) {
    return "";
  }
  return String(match[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function truncateText(value: string | undefined, maxLength = 2800): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
}

function buildOpenAIChatCompletionsUrl(baseUrl: string): string {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "/v1/chat/completions";
  }
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return /\/v\d+$/.test(trimmed)
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ok(id: string, payload: Record<string, unknown>): GatewayResFrame {
  return { type: "res", id, ok: true, payload };
}

function withMemoryClassConsumerPayload(
  payload: Record<string, unknown>,
  input: Parameters<typeof buildMemoryClassConsumerView>[0],
  memoryFreshness?: MemoryFreshnessView,
): Record<string, unknown> {
  return {
    ...payload,
    ...buildMemoryClassConsumerView(input),
    ...(memoryFreshness?.summary.available ? { memoryFreshness } : {}),
  };
}

function invalid(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "invalid_params", message } };
}

function notAvailable(id: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "not_available", message: "Memory manager is not available." } };
}

function notFound(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "not_found", message } };
}

function failure(id: string, code: string, error: unknown): GatewayResFrame {
  return {
    type: "res",
    id,
    ok: false,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  };
}
