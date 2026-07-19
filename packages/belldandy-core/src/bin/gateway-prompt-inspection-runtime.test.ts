import { describe, expect, it } from "vitest";

import type { AgentPromptSnapshot, SystemPromptBuildResult } from "@belldandy/agent";
import type { ToolExecutor } from "@belldandy/skills";

import { PromptSnapshotStore } from "../prompt-snapshot-store.js";
import { createGatewayPromptInspectionRuntime } from "./gateway-prompt-inspection-runtime.js";

function createToolExecutor(): ToolExecutor {
  return {
    getContracts: () => [],
    getRegisteredToolContracts: () => [],
    buildDeferredToolDiscoveryPromptSummary: () => "",
  } as unknown as ToolExecutor;
}

function createBaseBuild(text: string): SystemPromptBuildResult {
  return {
    text,
    sections: [],
    droppedSections: [],
    truncated: false,
    totalChars: text.length,
    finalChars: text.length,
  };
}

function createSnapshot(input: {
  conversationId: string;
  runId: string;
  createdAt: number;
  systemPrompt: string;
  sectionIds: string[];
  providerNativeBlockIds: string[];
  providerNativeSystemBlockTypes: string[];
  providerNativeCacheEligibleBlockIds: string[];
  toolBehaviorIncluded: string[];
}): AgentPromptSnapshot {
  return {
    agentId: "default",
    conversationId: input.conversationId,
    runId: input.runId,
    createdAt: input.createdAt,
    systemPrompt: input.systemPrompt,
    messages: [{ role: "system", content: input.systemPrompt }],
    providerNativeSystemBlocks: [
      {
        id: "provider-native-static-capability",
        blockType: "static-capability",
        text: input.systemPrompt,
        sourceSectionIds: [...input.sectionIds],
        sourceDeltaIds: [],
        cacheControlEligible: input.providerNativeCacheEligibleBlockIds.includes("provider-native-static-capability"),
      },
    ],
    inputMeta: {
      cacheSupport: "supported",
      sectionIds: [...input.sectionIds],
      providerNativeBlockIds: [...input.providerNativeBlockIds],
      providerNativeSystemBlockTypes: [...input.providerNativeSystemBlockTypes],
      providerNativeCacheEligibleBlockIds: [...input.providerNativeCacheEligibleBlockIds],
      toolBehaviorIncluded: [...input.toolBehaviorIncluded],
      structureSignature: `sig-${input.runId}`,
    },
  };
}

describe("gateway prompt inspection runtime", () => {
  it("derives fine-grained prefix drift reasons from previous snapshot metadata", () => {
    const promptSnapshotStore = new PromptSnapshotStore({ maxSnapshots: 8 });
    const boundedBaseBuild: SystemPromptBuildResult = {
      ...createBaseBuild("base prompt"),
      skillPromptBudget: {
        maxBytes: 64 * 1024,
        renderedBytes: 1024,
        fullInstructionCount: 1,
        deferredInstructionCount: 2,
        renderedSummaryCount: 2,
        omittedSummaryCount: 0,
        routingOmitted: false,
      },
    };
    const runtime = createGatewayPromptInspectionRuntime({
      stateDir: "E:/state",
      logger: {
        info: () => {},
        warn: () => {},
      },
      promptSnapshotStore,
      promptSnapshotMaxPersistedRuns: 4,
      promptSnapshotHeartbeatMaxRuns: 2,
      promptSnapshotEmailThreadMaxRuns: 2,
      promptSnapshotRetentionDays: 7,
      agentWorkspaceCache: new Map<string, {
        build: SystemPromptBuildResult;
      }>([
        ["default", { build: boundedBaseBuild }],
      ]),
      dynamicSystemPromptBuild: createBaseBuild("dynamic base"),
      toolExecutor: createToolExecutor(),
      isTtsEnabled: () => false,
      providerCacheSupport: "supported",
      providerCapabilitySource: "env",
    });

    promptSnapshotStore.save(createSnapshot({
      conversationId: "conv-1",
      runId: "run-1",
      createdAt: 1000,
      systemPrompt: "stable prompt",
      sectionIds: ["runtime-system-prompt"],
      providerNativeBlockIds: ["provider-native-static-capability"],
      providerNativeSystemBlockTypes: ["static-capability"],
      providerNativeCacheEligibleBlockIds: ["provider-native-static-capability"],
      toolBehaviorIncluded: ["run_command"],
    }));

    const inspection = runtime.buildRunPromptInspection(createSnapshot({
      conversationId: "conv-1",
      runId: "run-2",
      createdAt: 2500,
      systemPrompt: "stable prompt updated",
      sectionIds: ["runtime-system-prompt"],
      providerNativeBlockIds: ["provider-native-static-capability"],
      providerNativeSystemBlockTypes: ["static-capability"],
      providerNativeCacheEligibleBlockIds: [],
      toolBehaviorIncluded: ["apply_patch"],
    }));

    expect(inspection.metadata.prefixDrift).toMatchObject({
      status: "drifted",
      changed: true,
    });
    const prefixDrift = inspection.metadata.prefixDrift as { reasons?: string[] } | undefined;
    expect(prefixDrift?.reasons).toEqual(expect.arrayContaining([
      "system_prompt_fingerprint_changed",
      "provider_native_cache_eligible_blocks_changed",
      "tool_contract_list_changed",
      "prompt_structure_signature_changed",
    ]));
    expect(inspection.metadata.prefixWarmState).toMatchObject({
      eligible: true,
      status: "drifted",
      reason: "prefix_drift_detected",
      previousAgeMs: 1500,
    });
    expect(inspection.metadata.warmupCoordination).toMatchObject({
      eligible: true,
      status: "drifted",
      recommendation: "delay_if_possible",
      reason: "prefix_drift_detected",
    });
    expect(inspection.metadata.cacheFamilyAffinity).toMatchObject({
      status: "mismatch",
      reason: "cache_family_changed_since_previous_snapshot",
    });
    const agentInspection = runtime.buildEffectiveAgentPromptInspection({
      id: "default",
      displayName: "Default Agent",
      model: "test-model",
    } as any);
    expect(agentInspection.metadata.skillPromptBudget).toEqual(boundedBaseBuild.skillPromptBudget);
  });

  it("reports ordering guard risk for runtime-composed prompt snapshots", () => {
    const promptSnapshotStore = new PromptSnapshotStore({ maxSnapshots: 4 });
    const runtime = createGatewayPromptInspectionRuntime({
      stateDir: "E:/state",
      logger: {
        info: () => {},
        warn: () => {},
      },
      promptSnapshotStore,
      promptSnapshotMaxPersistedRuns: 4,
      promptSnapshotHeartbeatMaxRuns: 2,
      promptSnapshotEmailThreadMaxRuns: 2,
      promptSnapshotRetentionDays: 7,
      agentWorkspaceCache: new Map<string, {
        build: SystemPromptBuildResult;
      }>(),
      dynamicSystemPromptBuild: createBaseBuild("dynamic base"),
      toolExecutor: createToolExecutor(),
      isTtsEnabled: () => false,
      providerCacheSupport: "supported",
      providerCapabilitySource: "env",
    });

    const inspection = runtime.buildRunPromptInspection({
      agentId: "default",
      conversationId: "conv-risk",
      runId: "run-risk",
      createdAt: 100,
      systemPrompt: "runtime prompt",
      messages: [{ role: "system", content: "runtime prompt" }],
      deltas: [{
        id: "runtime-identity",
        deltaType: "runtime-identity",
        role: "system",
        text: "## Identity Context",
      }],
      inputMeta: {
        cacheSupport: "supported",
        toolBehaviorObservability: {
          included: ["run_command"],
        },
      },
    });

    expect(inspection.metadata.orderingGuard).toMatchObject({
      status: "risk",
    });
    const orderingGuard = inspection.metadata.orderingGuard as { reasons?: string[] } | undefined;
    expect(orderingGuard?.reasons).toEqual(expect.arrayContaining([
      "dynamic_runtime_sections_present",
      "provider_native_blocks_depend_on_runtime_composition",
      "tool_contract_list_injected",
    ]));
    expect(inspection.metadata.structureSignature).toEqual(expect.any(String));
    expect(inspection.metadata.warmupCoordination).toMatchObject({
      status: "cold",
      recommendation: "proceed_with_caution",
    });
    expect(inspection.metadata.cacheFamilyAffinity).toMatchObject({
      status: "unknown",
    });
  });
});
