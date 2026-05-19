import {
  estimateTokens,
  type AgentPromptDelta,
  type ProviderNativeSystemBlock,
  type SystemPromptSection,
} from "@belldandy/agent";

export type PromptTextMetrics = {
  charLength: number;
  estimatedChars: number;
  estimatedTokens: number;
};

export type PromptExperimentConfig = {
  disabledSectionIds: string[];
  sectionPriorityOverrides: Record<string, number>;
  disabledToolContractNames: string[];
};

export type PromptTokenBreakdown = {
  systemPromptEstimatedChars: number;
  systemPromptEstimatedTokens: number;
  sectionEstimatedChars: number;
  sectionEstimatedTokens: number;
  droppedSectionEstimatedChars: number;
  droppedSectionEstimatedTokens: number;
  deltaEstimatedChars: number;
  deltaEstimatedTokens: number;
  providerNativeSystemBlockEstimatedChars: number;
  providerNativeSystemBlockEstimatedTokens: number;
};

export type PromptInspectionLike = {
  scope?: "agent" | "run";
  agentId: string;
  displayName?: string;
  model?: string;
  conversationId?: string;
  runId?: string;
  createdAt?: number;
  text: string;
  truncated?: boolean;
  maxChars?: number;
  totalChars: number;
  finalChars: number;
  sections?: Array<{ id: string; text: string }>;
  droppedSections?: Array<{ id: string; text: string }>;
  deltas?: Array<{ id: string; deltaType?: string; text: string }>;
  providerNativeSystemBlocks?: Array<{ id: string; blockType?: string; text: string; cacheControlEligible?: boolean }>;
  metadata?: Record<string, unknown>;
};

export type PromptTruncationReason = {
  code: string;
  maxChars?: number;
  droppedSectionCount?: number;
  droppedSectionIds?: string[];
  droppedSectionLabels?: string[];
  truncatedSectionIds?: string[];
  truncatedSectionLabels?: string[];
  message?: string;
};

export type PromptObservabilitySummary = {
  scope?: "agent" | "run";
  agentId: string;
  displayName?: string;
  model?: string;
  conversationId?: string;
  runId?: string;
  createdAt?: number;
  counts: {
    sectionCount: number;
    droppedSectionCount: number;
    deltaCount: number;
    providerNativeSystemBlockCount: number;
  };
  promptSizes: {
    totalChars: number;
    finalChars: number;
  };
  tokenBreakdown: PromptTokenBreakdown;
  cacheSupport?: string;
  capabilitySource?: string;
  providerCacheEligible?: boolean;
  systemPromptFingerprint?: string;
  prefixDrift?: {
    status?: "first_snapshot" | "stable" | "drifted";
    changed?: boolean;
    reasons?: string[];
    previousFingerprint?: string;
    currentFingerprint?: string;
  };
  prefixWarmState?: {
    eligible?: boolean;
    status?: "cold" | "warming" | "warm_candidate" | "drifted" | "unsupported";
    samePrefixAsPrevious?: boolean;
    previousAgeMs?: number;
    reason?: string;
  };
  orderingGuard?: {
    status?: "stable" | "risk";
    reasons?: string[];
  };
  structureSignature?: string;
  cacheFamilyAffinity?: {
    status?: "unknown" | "aligned" | "mismatch";
    familyKey?: string;
    previousFamilyKey?: string;
    reason?: string;
  };
  warmupCoordination?: {
    eligible?: boolean;
    status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
    recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
    reason?: string;
    previousAgeMs?: number;
  };
  truncationReason?: PromptTruncationReason;
  experiments?: Record<string, unknown>;
};

export type PromptObservabilityView = {
  scope?: "agent" | "run";
  agentId?: string;
  displayName?: string;
  model?: string;
  conversationId?: string;
  runId?: string;
  createdAt?: number;
  counts?: Partial<PromptObservabilitySummary["counts"]>;
  promptSizes?: Partial<PromptObservabilitySummary["promptSizes"]>;
  tokenBreakdown?: Partial<PromptTokenBreakdown>;
  truncationReason?: PromptTruncationReason;
  flags?: {
    truncated?: boolean;
    includesHookSystemPrompt?: boolean;
    hasPrependContext?: boolean;
  };
};

export function measurePromptText(text: string): PromptTextMetrics {
  const charLength = text.length;
  return {
    charLength,
    estimatedChars: charLength,
    estimatedTokens: estimateTokens(text),
  };
}

export function withSectionPromptMetrics(
  section: SystemPromptSection,
): SystemPromptSection & PromptTextMetrics {
  return {
    ...section,
    ...measurePromptText(section.text),
  };
}

export function withDeltaPromptMetrics(
  delta: AgentPromptDelta,
): AgentPromptDelta & PromptTextMetrics {
  return {
    ...delta,
    ...measurePromptText(delta.text),
  };
}

export function withProviderNativeSystemBlockPromptMetrics(
  block: ProviderNativeSystemBlock,
): ProviderNativeSystemBlock & PromptTextMetrics {
  return {
    ...block,
    sourceSectionIds: [...block.sourceSectionIds],
    sourceDeltaIds: [...block.sourceDeltaIds],
    ...measurePromptText(block.text),
  };
}

export function buildPromptTokenBreakdown(input: {
  systemPromptText?: string;
  sections?: Array<{ text: string }>;
  droppedSections?: Array<{ text: string }>;
  deltas?: Array<{ text: string }>;
  providerNativeSystemBlocks?: Array<{ text: string }>;
}): PromptTokenBreakdown {
  return {
    systemPromptEstimatedChars: input.systemPromptText?.length ?? 0,
    systemPromptEstimatedTokens: estimateTokens(input.systemPromptText ?? ""),
    sectionEstimatedChars: sumTextChars(input.sections),
    sectionEstimatedTokens: sumTextTokens(input.sections),
    droppedSectionEstimatedChars: sumTextChars(input.droppedSections),
    droppedSectionEstimatedTokens: sumTextTokens(input.droppedSections),
    deltaEstimatedChars: sumTextChars(input.deltas),
    deltaEstimatedTokens: sumTextTokens(input.deltas),
    providerNativeSystemBlockEstimatedChars: sumTextChars(input.providerNativeSystemBlocks),
    providerNativeSystemBlockEstimatedTokens: sumTextTokens(input.providerNativeSystemBlocks),
  };
}

export function buildPromptObservabilitySummary(
  inspection: PromptInspectionLike,
): PromptObservabilitySummary {
  const metadata = isRecord(inspection.metadata) ? inspection.metadata : undefined;
  const tokenBreakdown = readPromptTokenBreakdownFromMetadata(metadata) ?? buildPromptTokenBreakdown({
    systemPromptText: inspection.text,
    sections: inspection.sections,
    droppedSections: inspection.droppedSections,
    deltas: inspection.deltas,
    providerNativeSystemBlocks: inspection.providerNativeSystemBlocks,
  });
  const truncationReason = readPromptTruncationReasonFromMetadata(metadata)
    ?? buildPromptTruncationReasonFromInspection(inspection);
  const prefixDrift = isRecord(metadata?.prefixDrift) ? metadata.prefixDrift as Record<string, unknown> : undefined;
  const prefixWarmState = isRecord(metadata?.prefixWarmState) ? metadata.prefixWarmState as Record<string, unknown> : undefined;
  const orderingGuard = isRecord(metadata?.orderingGuard) ? metadata.orderingGuard as Record<string, unknown> : undefined;
  const cacheFamilyAffinity = isRecord(metadata?.cacheFamilyAffinity) ? metadata.cacheFamilyAffinity as Record<string, unknown> : undefined;
  const warmupCoordination = isRecord(metadata?.warmupCoordination) ? metadata.warmupCoordination as Record<string, unknown> : undefined;

  return {
    scope: inspection.scope,
    agentId: inspection.agentId,
    ...(inspection.displayName ? { displayName: inspection.displayName } : {}),
    ...(inspection.model ? { model: inspection.model } : {}),
    ...(inspection.conversationId ? { conversationId: inspection.conversationId } : {}),
    ...(inspection.runId ? { runId: inspection.runId } : {}),
    ...(typeof inspection.createdAt === "number" ? { createdAt: inspection.createdAt } : {}),
    counts: {
      sectionCount: inspection.sections?.length ?? 0,
      droppedSectionCount: inspection.droppedSections?.length ?? 0,
      deltaCount: inspection.deltas?.length ?? 0,
      providerNativeSystemBlockCount: inspection.providerNativeSystemBlocks?.length ?? 0,
    },
    promptSizes: {
      totalChars: inspection.totalChars,
      finalChars: inspection.finalChars,
    },
    tokenBreakdown,
    ...(typeof metadata?.cacheSupport === "string" ? { cacheSupport: metadata.cacheSupport } : {}),
    ...(typeof metadata?.capabilitySource === "string" ? { capabilitySource: metadata.capabilitySource } : {}),
    ...(typeof metadata?.providerCacheEligible === "boolean" ? { providerCacheEligible: metadata.providerCacheEligible } : {}),
    ...(typeof metadata?.systemPromptFingerprint === "string" ? { systemPromptFingerprint: metadata.systemPromptFingerprint } : {}),
    ...(prefixDrift
      ? {
        prefixDrift: {
          ...(typeof prefixDrift.status === "string"
            ? { status: prefixDrift.status as NonNullable<PromptObservabilitySummary["prefixDrift"]>["status"] }
            : {}),
          ...(typeof prefixDrift.changed === "boolean" ? { changed: prefixDrift.changed } : {}),
          ...(Array.isArray(prefixDrift.reasons) ? { reasons: prefixDrift.reasons.filter((item) => typeof item === "string") } : {}),
          ...(typeof prefixDrift.previousFingerprint === "string"
            ? { previousFingerprint: prefixDrift.previousFingerprint }
            : {}),
          ...(typeof prefixDrift.currentFingerprint === "string"
            ? { currentFingerprint: prefixDrift.currentFingerprint }
            : {}),
        },
      }
      : {}),
    ...(prefixWarmState
      ? {
        prefixWarmState: {
          ...(typeof prefixWarmState.eligible === "boolean" ? { eligible: prefixWarmState.eligible } : {}),
          ...(typeof prefixWarmState.status === "string"
            ? { status: prefixWarmState.status as NonNullable<PromptObservabilitySummary["prefixWarmState"]>["status"] }
            : {}),
          ...(typeof prefixWarmState.samePrefixAsPrevious === "boolean"
            ? { samePrefixAsPrevious: prefixWarmState.samePrefixAsPrevious }
            : {}),
          ...(typeof prefixWarmState.previousAgeMs === "number"
            ? { previousAgeMs: prefixWarmState.previousAgeMs }
            : {}),
          ...(typeof prefixWarmState.reason === "string" ? { reason: prefixWarmState.reason } : {}),
        },
      }
      : {}),
    ...(orderingGuard
      ? {
        orderingGuard: {
          ...(typeof orderingGuard.status === "string"
            ? { status: orderingGuard.status as NonNullable<PromptObservabilitySummary["orderingGuard"]>["status"] }
            : {}),
          ...(Array.isArray(orderingGuard.reasons)
            ? { reasons: orderingGuard.reasons.filter((item) => typeof item === "string") }
            : {}),
        },
      }
      : {}),
    ...(typeof metadata?.structureSignature === "string" ? { structureSignature: metadata.structureSignature } : {}),
    ...(cacheFamilyAffinity
      ? {
        cacheFamilyAffinity: {
          ...(typeof cacheFamilyAffinity.status === "string"
            ? { status: cacheFamilyAffinity.status as NonNullable<PromptObservabilitySummary["cacheFamilyAffinity"]>["status"] }
            : {}),
          ...(typeof cacheFamilyAffinity.familyKey === "string" ? { familyKey: cacheFamilyAffinity.familyKey } : {}),
          ...(typeof cacheFamilyAffinity.previousFamilyKey === "string"
            ? { previousFamilyKey: cacheFamilyAffinity.previousFamilyKey }
            : {}),
          ...(typeof cacheFamilyAffinity.reason === "string" ? { reason: cacheFamilyAffinity.reason } : {}),
        },
      }
      : {}),
    ...(warmupCoordination
      ? {
        warmupCoordination: {
          ...(typeof warmupCoordination.eligible === "boolean" ? { eligible: warmupCoordination.eligible } : {}),
          ...(typeof warmupCoordination.status === "string"
            ? { status: warmupCoordination.status as NonNullable<PromptObservabilitySummary["warmupCoordination"]>["status"] }
            : {}),
          ...(typeof warmupCoordination.recommendation === "string"
            ? { recommendation: warmupCoordination.recommendation as NonNullable<PromptObservabilitySummary["warmupCoordination"]>["recommendation"] }
            : {}),
          ...(typeof warmupCoordination.reason === "string" ? { reason: warmupCoordination.reason } : {}),
          ...(typeof warmupCoordination.previousAgeMs === "number"
            ? { previousAgeMs: warmupCoordination.previousAgeMs }
            : {}),
        },
      }
      : {}),
    ...(truncationReason ? { truncationReason } : {}),
    ...(metadata?.promptExperiments && isRecord(metadata.promptExperiments)
      ? { experiments: metadata.promptExperiments }
      : {}),
  };
}

export function toPromptObservabilityView(
  summary: PromptObservabilitySummary,
  options?: {
    truncated?: boolean;
    includesHookSystemPrompt?: boolean;
    hasPrependContext?: boolean;
  },
): PromptObservabilityView {
  return {
    scope: summary.scope,
    agentId: summary.agentId,
    ...(summary.displayName ? { displayName: summary.displayName } : {}),
    ...(summary.model ? { model: summary.model } : {}),
    ...(summary.conversationId ? { conversationId: summary.conversationId } : {}),
    ...(summary.runId ? { runId: summary.runId } : {}),
    ...(typeof summary.createdAt === "number" ? { createdAt: summary.createdAt } : {}),
    counts: { ...summary.counts },
    promptSizes: { ...summary.promptSizes },
    tokenBreakdown: { ...summary.tokenBreakdown },
    ...(summary.truncationReason ? { truncationReason: { ...summary.truncationReason } } : {}),
    ...(options
      ? {
        flags: {
          ...(typeof options.truncated === "boolean" ? { truncated: options.truncated } : {}),
          ...(typeof options.includesHookSystemPrompt === "boolean"
            ? { includesHookSystemPrompt: options.includesHookSystemPrompt }
            : {}),
          ...(typeof options.hasPrependContext === "boolean"
            ? { hasPrependContext: options.hasPrependContext }
            : {}),
        },
      }
      : {}),
  };
}

export function formatPromptObservabilityHeadline(
  view: PromptObservabilityView,
): string {
  const parts: string[] = [];
  if (view.agentId) {
    parts.push(`agent=${view.agentId}`);
  }
  if (view.scope) {
    parts.push(`scope=${view.scope}`);
  }
  if (typeof view.promptSizes?.finalChars === "number") {
    parts.push(`finalChars=${view.promptSizes.finalChars}`);
  }
  if (typeof view.counts?.sectionCount === "number") {
    parts.push(`sections=${view.counts.sectionCount}`);
  }
  if (typeof view.counts?.droppedSectionCount === "number") {
    parts.push(`droppedSections=${view.counts.droppedSectionCount}`);
  }
  if (typeof view.counts?.deltaCount === "number") {
    parts.push(`deltas=${view.counts.deltaCount}`);
  }
  if (typeof view.counts?.providerNativeSystemBlockCount === "number") {
    parts.push(`blocks=${view.counts.providerNativeSystemBlockCount}`);
  }
  if (typeof view.tokenBreakdown?.systemPromptEstimatedTokens === "number") {
    parts.push(`systemTokens=${view.tokenBreakdown.systemPromptEstimatedTokens}`);
  }
  if (typeof view.tokenBreakdown?.deltaEstimatedTokens === "number") {
    parts.push(`deltaTokens=${view.tokenBreakdown.deltaEstimatedTokens}`);
  }
  if (typeof view.tokenBreakdown?.providerNativeSystemBlockEstimatedTokens === "number") {
    parts.push(`blockTokens=${view.tokenBreakdown.providerNativeSystemBlockEstimatedTokens}`);
  }
  if (view.truncationReason?.code) {
    parts.push(`truncation=${view.truncationReason.code}`);
  }
  return parts.join(", ");
}

export function renderPromptObservabilityText(
  view: PromptObservabilityView,
  options?: {
    heading?: string;
    indent?: string;
  },
): string {
  const heading = options?.heading ?? "Prompt Observability";
  const indent = options?.indent ?? "";
  const lines: string[] = [heading];

  appendPromptObservabilityLine(lines, indent, "scope", view.scope);
  appendPromptObservabilityLine(lines, indent, "agentId", view.agentId);
  appendPromptObservabilityLine(lines, indent, "displayName", view.displayName);
  appendPromptObservabilityLine(lines, indent, "model", view.model);
  appendPromptObservabilityLine(lines, indent, "conversationId", view.conversationId);
  appendPromptObservabilityLine(lines, indent, "runId", view.runId);
  appendPromptObservabilityLine(lines, indent, "createdAt", typeof view.createdAt === "number" ? new Date(view.createdAt).toISOString() : undefined);
  appendPromptObservabilityLine(lines, indent, "truncated", formatOptionalBoolean(view.flags?.truncated));
  appendPromptObservabilityLine(lines, indent, "includesHookSystemPrompt", formatOptionalBoolean(view.flags?.includesHookSystemPrompt));
  appendPromptObservabilityLine(lines, indent, "hasPrependContext", formatOptionalBoolean(view.flags?.hasPrependContext));
  appendPromptObservabilityLine(lines, indent, "sectionCount", view.counts?.sectionCount);
  appendPromptObservabilityLine(lines, indent, "droppedSectionCount", view.counts?.droppedSectionCount);
  appendPromptObservabilityLine(lines, indent, "deltaCount", view.counts?.deltaCount);
  appendPromptObservabilityLine(lines, indent, "providerNativeSystemBlockCount", view.counts?.providerNativeSystemBlockCount);
  appendPromptObservabilityLine(lines, indent, "totalChars", view.promptSizes?.totalChars);
  appendPromptObservabilityLine(lines, indent, "finalChars", view.promptSizes?.finalChars);
  appendPromptObservabilityLine(lines, indent, "systemPromptEstimatedChars", view.tokenBreakdown?.systemPromptEstimatedChars);
  appendPromptObservabilityLine(lines, indent, "systemPromptEstimatedTokens", view.tokenBreakdown?.systemPromptEstimatedTokens);
  appendPromptObservabilityLine(lines, indent, "sectionEstimatedChars", view.tokenBreakdown?.sectionEstimatedChars);
  appendPromptObservabilityLine(lines, indent, "sectionEstimatedTokens", view.tokenBreakdown?.sectionEstimatedTokens);
  appendPromptObservabilityLine(lines, indent, "droppedSectionEstimatedChars", view.tokenBreakdown?.droppedSectionEstimatedChars);
  appendPromptObservabilityLine(lines, indent, "droppedSectionEstimatedTokens", view.tokenBreakdown?.droppedSectionEstimatedTokens);
  appendPromptObservabilityLine(lines, indent, "deltaEstimatedChars", view.tokenBreakdown?.deltaEstimatedChars);
  appendPromptObservabilityLine(lines, indent, "deltaEstimatedTokens", view.tokenBreakdown?.deltaEstimatedTokens);
  appendPromptObservabilityLine(lines, indent, "providerNativeSystemBlockEstimatedChars", view.tokenBreakdown?.providerNativeSystemBlockEstimatedChars);
  appendPromptObservabilityLine(lines, indent, "providerNativeSystemBlockEstimatedTokens", view.tokenBreakdown?.providerNativeSystemBlockEstimatedTokens);
  appendPromptObservabilityLine(lines, indent, "truncationReasonCode", view.truncationReason?.code);
  appendPromptObservabilityLine(lines, indent, "truncationReasonMessage", view.truncationReason?.message);
  appendPromptObservabilityLine(lines, indent, "truncationMaxChars", view.truncationReason?.maxChars);
  appendPromptObservabilityLine(lines, indent, "truncationDroppedSectionCount", view.truncationReason?.droppedSectionCount);
  appendPromptObservabilityLine(
    lines,
    indent,
    "truncationDroppedSectionIds",
    view.truncationReason?.droppedSectionIds?.join(", "),
  );
  appendPromptObservabilityLine(
    lines,
    indent,
    "truncationDroppedSectionLabels",
    view.truncationReason?.droppedSectionLabels?.join(", "),
  );
  appendPromptObservabilityLine(
    lines,
    indent,
    "truncationTruncatedSectionIds",
    view.truncationReason?.truncatedSectionIds?.join(", "),
  );
  appendPromptObservabilityLine(
    lines,
    indent,
    "truncationTruncatedSectionLabels",
    view.truncationReason?.truncatedSectionLabels?.join(", "),
  );

  return lines.join("\n");
}

export function readPromptTruncationReasonFromMetadata(
  metadata?: Record<string, unknown>,
): PromptTruncationReason | undefined {
  const rawValue = metadata?.truncationReason;
  if (!isRecord(rawValue)) {
    return undefined;
  }

  const value = rawValue as Record<string, unknown>;
  const code = typeof value.code === "string" && value.code.trim()
    ? value.code.trim()
    : undefined;
  if (!code) {
    return undefined;
  }

  const droppedSectionIds = normalizeStringArray(value.droppedSectionIds);
  const droppedSectionLabels = normalizeStringArray(value.droppedSectionLabels);
  const truncatedSectionIds = normalizeStringArray(value.truncatedSectionIds);
  const truncatedSectionLabels = normalizeStringArray(value.truncatedSectionLabels);
  const result: PromptTruncationReason = {
    code,
    ...(typeof value.maxChars === "number" && Number.isFinite(value.maxChars) && value.maxChars > 0
      ? { maxChars: Math.trunc(value.maxChars) }
      : {}),
    ...(typeof value.droppedSectionCount === "number" && Number.isFinite(value.droppedSectionCount) && value.droppedSectionCount >= 0
      ? { droppedSectionCount: Math.trunc(value.droppedSectionCount) }
      : {}),
    ...(droppedSectionIds.length > 0 ? { droppedSectionIds } : {}),
    ...(droppedSectionLabels.length > 0 ? { droppedSectionLabels } : {}),
    ...(truncatedSectionIds.length > 0 ? { truncatedSectionIds } : {}),
    ...(truncatedSectionLabels.length > 0 ? { truncatedSectionLabels } : {}),
    ...(typeof value.message === "string" && value.message.trim()
      ? { message: value.message.trim() }
      : {}),
  };

  return result;
}

export function parsePromptExperimentConfig(input: {
  disabledSectionIdsRaw?: string;
  sectionPriorityOverridesRaw?: string;
  disabledToolContractNamesRaw?: string;
}): PromptExperimentConfig | undefined {
  const disabledSectionIds = normalizeCsv(input.disabledSectionIdsRaw);
  const sectionPriorityOverrides = normalizePriorityOverrideMap(input.sectionPriorityOverridesRaw);
  const disabledToolContractNames = normalizeCsv(input.disabledToolContractNamesRaw);
  if (
    disabledSectionIds.length === 0
    && Object.keys(sectionPriorityOverrides).length === 0
    && disabledToolContractNames.length === 0
  ) {
    return undefined;
  }
  return {
    disabledSectionIds,
    sectionPriorityOverrides,
    disabledToolContractNames,
  };
}

export function applyPromptExperimentsToSections(
  sections: SystemPromptSection[],
  config?: PromptExperimentConfig,
): {
  sections: SystemPromptSection[];
  droppedSections: SystemPromptSection[];
  disabledSectionIdsApplied: string[];
  sectionPriorityOverridesApplied: Record<string, number>;
} {
  const sectionsWithOverrides = applySectionPriorityOverrides(
    sections,
    config?.sectionPriorityOverrides,
  );
  const orderedSections = sortSectionsByPriority(sectionsWithOverrides);
  const sectionPriorityOverridesApplied = orderedSections.reduce<Record<string, number>>((result, section) => {
    if (config?.sectionPriorityOverrides && Object.prototype.hasOwnProperty.call(config.sectionPriorityOverrides, section.id)) {
      result[section.id] = section.priority;
    }
    return result;
  }, {});

  if (!config || config.disabledSectionIds.length === 0) {
    return {
      sections: orderedSections,
      droppedSections: [],
      disabledSectionIdsApplied: [],
      sectionPriorityOverridesApplied,
    };
  }

  const disabledIds = new Set(config.disabledSectionIds);
  const keptSections: SystemPromptSection[] = [];
  const droppedSections: SystemPromptSection[] = [];

  for (const section of orderedSections) {
    if (disabledIds.has(section.id)) {
      droppedSections.push(section);
      continue;
    }
    keptSections.push(section);
  }

  return {
    sections: keptSections,
    droppedSections,
    disabledSectionIdsApplied: config.disabledSectionIds.filter((id) => droppedSections.some((section) => section.id === id)),
    sectionPriorityOverridesApplied,
  };
}

function sumTextChars(items?: Array<{ text: string }>): number {
  return items?.reduce((sum, item) => sum + item.text.length, 0) ?? 0;
}

function sumTextTokens(items?: Array<{ text: string }>): number {
  return items?.reduce((sum, item) => sum + estimateTokens(item.text), 0) ?? 0;
}

function appendPromptObservabilityLine(
  lines: string[],
  indent: string,
  key: string,
  value: string | number | undefined,
): void {
  if (value === undefined) {
    return;
  }
  lines.push(`${indent}${key}: ${value}`);
}

function formatOptionalBoolean(value: boolean | undefined): string | undefined {
  if (typeof value !== "boolean") {
    return undefined;
  }
  return value ? "yes" : "no";
}

function buildPromptTruncationReasonFromInspection(
  inspection: PromptInspectionLike,
): PromptTruncationReason | undefined {
  if (inspection.truncated !== true || !inspection.maxChars || !inspection.droppedSections || inspection.droppedSections.length === 0) {
    return undefined;
  }
  const droppedSectionIds = inspection.droppedSections.map((section) => section.id);
  return {
    code: "max_chars_limit",
    maxChars: inspection.maxChars,
    droppedSectionCount: inspection.droppedSections.length,
    droppedSectionIds,
    droppedSectionLabels: [...droppedSectionIds],
    message: `Dropped ${droppedSectionIds.join(", ")} to fit ${inspection.maxChars} char limit.`,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function normalizeCsv(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePriorityOverrideMap(raw?: string): Record<string, number> {
  if (!raw) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const id = trimmed.slice(0, separatorIndex).trim();
    const value = Number(trimmed.slice(separatorIndex + 1).trim());
    if (!id || !Number.isFinite(value)) {
      continue;
    }
    result[id] = Math.trunc(value);
  }

  return result;
}

function applySectionPriorityOverrides(
  sections: SystemPromptSection[],
  overrides?: Record<string, number>,
): SystemPromptSection[] {
  if (!overrides || Object.keys(overrides).length === 0) {
    return [...sections];
  }

  return sections.map((section) => ({
    ...section,
    priority: Object.prototype.hasOwnProperty.call(overrides, section.id)
      ? overrides[section.id]!
      : section.priority,
  }));
}

function sortSectionsByPriority(
  sections: SystemPromptSection[],
): SystemPromptSection[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const priorityDiff = left.section.priority - right.section.priority;
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.section);
}

export function readPromptTokenBreakdownFromMetadata(
  metadata?: Record<string, unknown>,
): PromptTokenBreakdown | undefined {
  const rawValue = metadata?.tokenBreakdown;
  if (!isRecord(rawValue)) {
    return undefined;
  }
  const value = rawValue as Record<string, unknown>;
  const breakdown: PromptTokenBreakdown = {
    systemPromptEstimatedChars: readNonNegativeNumber(value.systemPromptEstimatedChars),
    systemPromptEstimatedTokens: readNonNegativeNumber(value.systemPromptEstimatedTokens),
    sectionEstimatedChars: readNonNegativeNumber(value.sectionEstimatedChars),
    sectionEstimatedTokens: readNonNegativeNumber(value.sectionEstimatedTokens),
    droppedSectionEstimatedChars: readNonNegativeNumber(value.droppedSectionEstimatedChars),
    droppedSectionEstimatedTokens: readNonNegativeNumber(value.droppedSectionEstimatedTokens),
    deltaEstimatedChars: readNonNegativeNumber(value.deltaEstimatedChars),
    deltaEstimatedTokens: readNonNegativeNumber(value.deltaEstimatedTokens),
    providerNativeSystemBlockEstimatedChars: readNonNegativeNumber(value.providerNativeSystemBlockEstimatedChars),
    providerNativeSystemBlockEstimatedTokens: readNonNegativeNumber(value.providerNativeSystemBlockEstimatedTokens),
  };
  return breakdown;
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
