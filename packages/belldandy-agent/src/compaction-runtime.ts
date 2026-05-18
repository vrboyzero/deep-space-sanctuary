import type { CompactionOptions, CompactionResult } from "./compaction.js";

export type CompactionRuntimeSource = "request" | "manual" | "session_memory" | "loop";

export type CompactionRuntimeSkipDecision = {
  skipped: boolean;
  circuitOpen: boolean;
  remainingSkips: number;
  reason?: string;
};

export type CompactionRuntimeReport = {
  configured: boolean;
  thresholds: {
    warningThreshold?: number;
    blockingThreshold?: number;
    maxConsecutiveCompactionFailures: number;
    maxPromptTooLongRetries: number;
  };
  totals: {
    attempts: number;
    compacted: number;
    fallbacks: number;
    failures: number;
    warningHits: number;
    blockingHits: number;
    promptTooLongRetries: number;
    skippedByCircuitBreaker: number;
    circuitOpened: number;
  };
  circuitBreaker: {
    open: boolean;
    consecutiveFailures: number;
    remainingSkips: number;
    lastFailureReason?: string;
    lastFailureAt?: number;
    lastOpenedAt?: number;
  };
  lastResult?: {
    source: CompactionRuntimeSource;
    compacted: boolean;
    fallbackUsed: boolean;
    warningTriggered: boolean;
    blockingTriggered: boolean;
    promptTooLongRetries: number;
    failureReason?: string;
    savedTokenCount: number;
    updatedAt: number;
    summarizerObservability?: {
      mode?: "rolling" | "archival";
      cacheAlignedRequested?: boolean;
      cacheSupport?: "supported" | "unsupported" | "unknown";
      cacheHitTokens?: number;
      cacheMissTokens?: number;
      cacheSavingsUsd?: number;
      usedWireApi?: "chat_completions" | "responses";
      compareAvailable?: boolean;
      comparison?: {
        mode?: "cache_aligned_vs_plain";
        plainRequestMessageCount?: number;
        cacheAlignedRequestMessageCount?: number;
        plainPromptCharsEstimate?: number;
        cacheAlignedReplayCharsEstimate?: number;
        cacheAlignedInstructionChars?: number;
        replayOverheadChars?: number;
      };
      strategy?: {
        kind?: "cache_aligned" | "plain";
        providerCacheMode?: "supported" | "unsupported" | "unknown";
        selectionReason?: string;
        degradePath?: string;
        providerModelNotes?: string;
        fallbackPolicy?: string;
        fallbackTriggered?: boolean;
        fallbackSummary?: string;
      };
      warmupCoordination?: {
        eligible?: boolean;
        status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
        recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
        reason?: string;
        previousAgeMs?: number;
      };
      cacheFamilyAffinity?: {
        status?: "unknown" | "aligned" | "mismatch";
        familyKey?: string;
        previousFamilyKey?: string;
        reason?: string;
      };
      fallbackStage?: "request" | "response_parse" | "compaction_budget" | "prompt_too_long" | "model_failure";
      failureReason?: string;
    };
  };
};

type CompactionRuntimeRecordOptions = {
  source: CompactionRuntimeSource;
  participatesInCircuitBreaker?: boolean;
};

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export class CompactionRuntimeTracker {
  private readonly warningThreshold?: number;
  private readonly blockingThreshold?: number;
  private readonly maxConsecutiveCompactionFailures: number;
  private readonly maxPromptTooLongRetries: number;
  private attempts = 0;
  private compacted = 0;
  private fallbacks = 0;
  private failures = 0;
  private warningHits = 0;
  private blockingHits = 0;
  private promptTooLongRetries = 0;
  private skippedByCircuitBreaker = 0;
  private circuitOpened = 0;
  private consecutiveFailures = 0;
  private remainingSkips = 0;
  private lastFailureReason?: string;
  private lastFailureAt?: number;
  private lastOpenedAt?: number;
  private lastResult?: CompactionRuntimeReport["lastResult"];

  constructor(options: Pick<
    CompactionOptions,
    "warningThreshold" | "blockingThreshold" | "maxConsecutiveCompactionFailures" | "maxPromptTooLongRetries"
  > = {}) {
    this.warningThreshold = typeof options.warningThreshold === "number" && Number.isFinite(options.warningThreshold)
      ? Math.max(0, Math.floor(options.warningThreshold))
      : undefined;
    this.blockingThreshold = typeof options.blockingThreshold === "number" && Number.isFinite(options.blockingThreshold)
      ? Math.max(0, Math.floor(options.blockingThreshold))
      : undefined;
    this.maxConsecutiveCompactionFailures = normalizePositiveInt(options.maxConsecutiveCompactionFailures, 3);
    this.maxPromptTooLongRetries = normalizePositiveInt(options.maxPromptTooLongRetries, 2);
  }

  shouldSkip(source: CompactionRuntimeSource, options: { allowBypass?: boolean } = {}): CompactionRuntimeSkipDecision {
    if (options.allowBypass) {
      return {
        skipped: false,
        circuitOpen: this.remainingSkips > 0,
        remainingSkips: this.remainingSkips,
      };
    }
    if (this.remainingSkips <= 0) {
      return {
        skipped: false,
        circuitOpen: false,
        remainingSkips: 0,
      };
    }

    this.skippedByCircuitBreaker += 1;
    this.remainingSkips = Math.max(0, this.remainingSkips - 1);
    this.lastResult = {
      source,
      compacted: false,
      fallbackUsed: false,
      warningTriggered: false,
      blockingTriggered: false,
      promptTooLongRetries: 0,
      failureReason: "skipped_by_circuit_breaker",
      savedTokenCount: 0,
      updatedAt: Date.now(),
      ...(this.lastResult?.summarizerObservability
        ? { summarizerObservability: { ...this.lastResult.summarizerObservability } }
        : {}),
    };

    return {
      skipped: true,
      circuitOpen: true,
      remainingSkips: this.remainingSkips,
      reason: "skipped_by_circuit_breaker",
    };
  }

  recordResult(result: CompactionResult, options: CompactionRuntimeRecordOptions): void {
    const participatesInCircuitBreaker = options.participatesInCircuitBreaker !== false;
    this.attempts += 1;
    if (result.compacted) this.compacted += 1;
    if (result.fallbackUsed) this.fallbacks += 1;
    if (result.warningTriggered) this.warningHits += 1;
    if (result.blockingTriggered) this.blockingHits += 1;
    if (result.promptTooLongRetries > 0) {
      this.promptTooLongRetries += result.promptTooLongRetries;
    }

    if (result.failureReason) {
      this.failures += 1;
      this.consecutiveFailures += 1;
      this.lastFailureReason = result.failureReason;
      this.lastFailureAt = Date.now();
      if (
        participatesInCircuitBreaker
        && this.maxConsecutiveCompactionFailures > 0
        && this.consecutiveFailures >= this.maxConsecutiveCompactionFailures
      ) {
        this.remainingSkips = Math.max(this.remainingSkips, this.maxConsecutiveCompactionFailures);
        this.circuitOpened += 1;
        this.lastOpenedAt = Date.now();
      }
    } else {
      this.consecutiveFailures = 0;
      this.remainingSkips = 0;
    }

    this.lastResult = {
      source: options.source,
      compacted: result.compacted,
      fallbackUsed: result.fallbackUsed,
      warningTriggered: result.warningTriggered,
      blockingTriggered: result.blockingTriggered,
      promptTooLongRetries: result.promptTooLongRetries,
      failureReason: result.failureReason,
      savedTokenCount: Math.max(0, result.originalTokens - result.compactedTokens),
      updatedAt: Date.now(),
      ...(result.summarizerObservability ? { summarizerObservability: { ...result.summarizerObservability } } : {}),
    };
  }

  getReport(): CompactionRuntimeReport {
    return {
      configured: Boolean(
        this.warningThreshold
        || this.blockingThreshold
        || this.maxConsecutiveCompactionFailures > 0
        || this.maxPromptTooLongRetries > 0,
      ),
      thresholds: {
        warningThreshold: this.warningThreshold,
        blockingThreshold: this.blockingThreshold,
        maxConsecutiveCompactionFailures: this.maxConsecutiveCompactionFailures,
        maxPromptTooLongRetries: this.maxPromptTooLongRetries,
      },
      totals: {
        attempts: this.attempts,
        compacted: this.compacted,
        fallbacks: this.fallbacks,
        failures: this.failures,
        warningHits: this.warningHits,
        blockingHits: this.blockingHits,
        promptTooLongRetries: this.promptTooLongRetries,
        skippedByCircuitBreaker: this.skippedByCircuitBreaker,
        circuitOpened: this.circuitOpened,
      },
      circuitBreaker: {
        open: this.remainingSkips > 0,
        consecutiveFailures: this.consecutiveFailures,
        remainingSkips: this.remainingSkips,
        lastFailureReason: this.lastFailureReason,
        lastFailureAt: this.lastFailureAt,
        lastOpenedAt: this.lastOpenedAt,
      },
      lastResult: this.lastResult,
    };
  }
}
