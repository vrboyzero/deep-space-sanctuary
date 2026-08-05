const TUI_PERFORMANCE_PHASES = ["startup", "resize", "inputReplay", "exit"];
const TUI_PERFORMANCE_PLATFORMS = ["windows-native", "wsl2-linux"];
const REQUIRED_LIFECYCLE_FLAGS = [
  "firstFrame",
  "narrowFallback",
  "wideLayoutRestored",
  "mouseTabNavigation",
  "inputReplayRendered",
  "ctrlCSent",
  "bracketedPasteRestored",
  "mouseTrackingRestored",
  "sgrMouseRestored",
  "alternateScreenRestored",
  "inputModesRestoredBeforeScreen",
  "stateDirRemoved",
];

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNumber(value, label, { allowZero = true } = {}) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${label} must be a ${allowZero ? "non-negative" : "positive"} finite number.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label, { allowZero = true } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer.`);
  }
  return value;
}

function requirePlatform(value, label = "platform") {
  if (!TUI_PERFORMANCE_PLATFORMS.includes(value)) {
    throw new Error(`${label} must be one of ${TUI_PERFORMANCE_PLATFORMS.join(", ")}.`);
  }
  return value;
}

function normalizeEnvironment(platform, value) {
  const environment = requireObject(value, "environment");
  const normalized = {
    platform: requireNonEmptyString(environment.platform, "environment.platform"),
    arch: requireNonEmptyString(environment.arch, "environment.arch"),
    release: requireNonEmptyString(environment.release, "environment.release"),
    nodeVersion: requireNonEmptyString(environment.nodeVersion, "environment.nodeVersion"),
    terminalBackend: requireNonEmptyString(environment.terminalBackend, "environment.terminalBackend"),
    wsl: environment.wsl === true,
    ...(typeof environment.distribution === "string" && environment.distribution.trim()
      ? { distribution: environment.distribution.trim() }
      : {}),
  };
  if (platform === "windows-native"
    && (normalized.platform !== "win32" || normalized.terminalBackend !== "conpty" || normalized.wsl)) {
    throw new Error("windows-native requires the win32/conpty platform fingerprint.");
  }
  if (platform === "wsl2-linux"
    && (normalized.platform !== "linux" || normalized.terminalBackend !== "unix-pty" || !normalized.wsl)) {
    throw new Error("wsl2-linux requires the linux/unix-pty WSL platform fingerprint.");
  }
  return normalized;
}

function normalizeSample(sample, expectedSequence) {
  requireObject(sample, `samples[${expectedSequence - 1}]`);
  if (sample.sequence !== expectedSequence) {
    throw new Error(`samples[${expectedSequence - 1}].sequence must be ${expectedSequence}.`);
  }
  const durations = requireObject(sample.durationsMs, `samples[${expectedSequence - 1}].durationsMs`);
  const durationsMs = Object.fromEntries(TUI_PERFORMANCE_PHASES.map((phase) => [
    phase,
    round(requireFiniteNumber(
      durations[phase],
      `samples[${expectedSequence - 1}].durationsMs.${phase}`,
      { allowZero: false },
    )),
  ]));
  const lifecycle = requireObject(sample.lifecycle, `samples[${expectedSequence - 1}].lifecycle`);
  for (const field of REQUIRED_LIFECYCLE_FLAGS) {
    if (lifecycle[field] !== true) {
      throw new Error(`samples[${expectedSequence - 1}].lifecycle.${field} must be true.`);
    }
  }
  if (lifecycle.exitCode !== 0) {
    throw new Error(`samples[${expectedSequence - 1}].lifecycle.exitCode must be 0.`);
  }
  if (lifecycle.timedOut !== false) {
    throw new Error(`samples[${expectedSequence - 1}].lifecycle.timedOut must be false.`);
  }
  const observedProcessCount = requireNonNegativeInteger(
    lifecycle.observedProcessCount,
    `samples[${expectedSequence - 1}].lifecycle.observedProcessCount`,
    { allowZero: false },
  );
  const residualProcessCount = requireNonNegativeInteger(
    lifecycle.residualProcessCount,
    `samples[${expectedSequence - 1}].lifecycle.residualProcessCount`,
  );
  if (residualProcessCount !== 0) {
    throw new Error(`samples[${expectedSequence - 1}].lifecycle.residualProcessCount must be 0.`);
  }
  return {
    sequence: expectedSequence,
    durationsMs,
    capturedBytes: requireNonNegativeInteger(
      sample.capturedBytes,
      `samples[${expectedSequence - 1}].capturedBytes`,
      { allowZero: false },
    ),
    lifecycle: {
      ...Object.fromEntries(REQUIRED_LIFECYCLE_FLAGS.map((field) => [field, true])),
      exitCode: 0,
      timedOut: false,
      observedProcessCount,
      residualProcessCount,
    },
  };
}

export function summarizeTuiDurationSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("TUI duration summary requires at least one sample.");
  }
  const sorted = samples
    .map((value, index) => requireFiniteNumber(value, `samples[${index}]`, { allowZero: false }))
    .sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const nearestRank = (quantile) => sorted[Math.max(0, Math.ceil(quantile * sampleCount) - 1)];
  const p50Ms = nearestRank(0.5);
  const p99Ms = nearestRank(0.99);
  return {
    unit: "milliseconds",
    sampleCount,
    minMs: round(sorted[0]),
    maxMs: round(sorted[sampleCount - 1]),
    meanMs: round(sorted.reduce((total, value) => total + value, 0) / sampleCount),
    p50Ms: round(p50Ms),
    p95Ms: round(nearestRank(0.95)),
    p99Ms: round(p99Ms),
    jitterRate: round((p99Ms - p50Ms) / Math.max(p50Ms, 1)),
    percentileMethod: "nearest-rank",
    jitterFormula: "(p99-p50)/max(p50,1ms)",
  };
}

export function createTuiPerformancePlatformResult({
  platform,
  environment,
  samples,
  minimumSampleCount = 5,
}) {
  const normalizedPlatform = requirePlatform(platform);
  const normalizedMinimum = requireNonNegativeInteger(minimumSampleCount, "minimumSampleCount", {
    allowZero: false,
  });
  if (!Array.isArray(samples) || samples.length < normalizedMinimum) {
    throw new Error(`${normalizedPlatform} requires at least ${normalizedMinimum} measured samples.`);
  }
  const normalizedSamples = samples.map((entry, index) => normalizeSample(entry, index + 1));
  const metrics = Object.fromEntries(TUI_PERFORMANCE_PHASES.map((phase) => [
    phase,
    summarizeTuiDurationSamples(normalizedSamples.map((entry) => entry.durationsMs[phase])),
  ]));
  return {
    platform: normalizedPlatform,
    environment: normalizeEnvironment(normalizedPlatform, environment),
    sampleCount: normalizedSamples.length,
    samples: normalizedSamples,
    metrics,
    lifecycle: {
      allSamplesPassed: true,
      observedProcessCount: normalizedSamples.reduce(
        (total, entry) => total + entry.lifecycle.observedProcessCount,
        0,
      ),
      residualProcessCount: 0,
    },
  };
}

function normalizeRegressionPolicy(value) {
  const policy = requireObject(value, "baseline.regressionPolicy");
  return {
    p99Ratio: requireFiniteNumber(policy.p99Ratio, "baseline.regressionPolicy.p99Ratio", { allowZero: false }),
    p99AllowanceMs: requireFiniteNumber(policy.p99AllowanceMs, "baseline.regressionPolicy.p99AllowanceMs"),
    jitterRateRatio: requireFiniteNumber(
      policy.jitterRateRatio,
      "baseline.regressionPolicy.jitterRateRatio",
      { allowZero: false },
    ),
    jitterRateAllowance: requireFiniteNumber(
      policy.jitterRateAllowance,
      "baseline.regressionPolicy.jitterRateAllowance",
    ),
  };
}

export function evaluateTuiPerformanceAgainstBaseline(platformResult, baseline) {
  requireObject(platformResult, "platformResult");
  const platform = requirePlatform(platformResult.platform, "platformResult.platform");
  requireObject(baseline, "baseline");
  if (baseline.schemaVersion !== "tui-performance-baseline/v1") {
    throw new Error("baseline.schemaVersion must be tui-performance-baseline/v1.");
  }
  const minimumSampleCount = requireNonNegativeInteger(
    baseline.minimumSampleCount,
    "baseline.minimumSampleCount",
    { allowZero: false },
  );
  if (platformResult.sampleCount < minimumSampleCount) {
    throw new Error(`${platform} requires at least ${minimumSampleCount} baseline-gated samples.`);
  }
  const platformBaseline = requireObject(
    requireObject(baseline.platforms, "baseline.platforms")[platform],
    `${platform} baseline`,
  );
  requireNonEmptyString(platformBaseline.capturedAt, `${platform} baseline.capturedAt`);
  requireNonEmptyString(platformBaseline.sourceCommit, `${platform} baseline.sourceCommit`);
  const baselineMetrics = requireObject(platformBaseline.metrics, `${platform} baseline.metrics`);
  const policy = normalizeRegressionPolicy(baseline.regressionPolicy);
  const failures = [];
  const comparisons = {};

  for (const phase of TUI_PERFORMANCE_PHASES) {
    const observed = requireObject(platformResult.metrics?.[phase], `platformResult.metrics.${phase}`);
    const historical = requireObject(baselineMetrics[phase], `${platform} baseline.metrics.${phase}`);
    const baselineP99Ms = requireFiniteNumber(historical.p99Ms, `${platform} baseline.metrics.${phase}.p99Ms`);
    const baselineJitterRate = requireFiniteNumber(
      historical.jitterRate,
      `${platform} baseline.metrics.${phase}.jitterRate`,
    );
    const p99LimitMs = round(baselineP99Ms * policy.p99Ratio + policy.p99AllowanceMs);
    const jitterRateLimit = round(
      baselineJitterRate * policy.jitterRateRatio + policy.jitterRateAllowance,
    );
    if (observed.p99Ms > p99LimitMs) {
      failures.push(`${phase} p99 ${observed.p99Ms}ms exceeds ${platform} limit ${p99LimitMs}ms.`);
    }
    if (observed.jitterRate > jitterRateLimit) {
      failures.push(`${phase} jitter ${observed.jitterRate} exceeds ${platform} limit ${jitterRateLimit}.`);
    }
    comparisons[phase] = {
      observedP99Ms: observed.p99Ms,
      baselineP99Ms,
      p99LimitMs,
      observedJitterRate: observed.jitterRate,
      baselineJitterRate,
      jitterRateLimit,
    };
  }

  return {
    schemaVersion: "tui-performance-gate/v1",
    baselineSchemaVersion: baseline.schemaVersion,
    baselineCapturedAt: platformBaseline.capturedAt,
    baselineSourceCommit: platformBaseline.sourceCommit,
    policy,
    comparisons,
    passed: failures.length === 0,
    failures,
  };
}

export function createTuiPerformanceReport({
  generatedAt,
  source,
  fixture,
  platformResults,
  baseline,
  requiredPlatforms = TUI_PERFORMANCE_PLATFORMS,
}) {
  requireNonEmptyString(generatedAt, "generatedAt");
  requireObject(source, "source");
  requireNonEmptyString(source.commit, "source.commit");
  if (typeof source.workspaceDirty !== "boolean") {
    throw new Error("source.workspaceDirty must be a boolean.");
  }
  requireObject(fixture, "fixture");
  const normalizedFixture = {
    warmupRuns: requireNonNegativeInteger(fixture.warmupRuns, "fixture.warmupRuns"),
    sampleRuns: requireNonNegativeInteger(fixture.sampleRuns, "fixture.sampleRuns", { allowZero: false }),
    replayCharacterCount: requireNonNegativeInteger(
      fixture.replayCharacterCount,
      "fixture.replayCharacterCount",
      { allowZero: false },
    ),
  };
  if (!Array.isArray(requiredPlatforms) || requiredPlatforms.length === 0) {
    throw new Error("requiredPlatforms must contain at least one platform.");
  }
  const normalizedRequired = requiredPlatforms.map((platform, index) => requirePlatform(
    platform,
    `requiredPlatforms[${index}]`,
  ));
  if (new Set(normalizedRequired).size !== normalizedRequired.length) {
    throw new Error("requiredPlatforms must not contain duplicates.");
  }
  if (!Array.isArray(platformResults)) {
    throw new Error("platformResults must be an array.");
  }
  const byPlatform = new Map(platformResults.map((result) => [result.platform, result]));
  if (byPlatform.size !== platformResults.length) {
    throw new Error("platformResults must not contain duplicate platforms.");
  }
  const platforms = normalizedRequired.map((platform) => {
    const result = byPlatform.get(platform);
    if (!result) throw new Error(`platformResults is missing ${platform}.`);
    const gate = evaluateTuiPerformanceAgainstBaseline(result, baseline);
    return { ...result, gate };
  });
  const failures = platforms.flatMap((entry) => entry.gate.failures.map(
    (failure) => `${entry.platform}: ${failure}`,
  ));
  return {
    schemaVersion: "tui-performance-report/v1",
    generatedAt,
    source: {
      commit: requireNonEmptyString(source.commit, "source.commit"),
      workspaceDirty: source.workspaceDirty,
    },
    fixture: normalizedFixture,
    platforms,
    gate: {
      passed: failures.length === 0,
      failures,
    },
  };
}

export { TUI_PERFORMANCE_PHASES, TUI_PERFORMANCE_PLATFORMS };
