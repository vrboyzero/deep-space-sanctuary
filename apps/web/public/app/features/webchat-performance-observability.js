const DEFAULT_MAX_STARTUP_MARKS = 32;
const DEFAULT_MAX_RENDER_SAMPLES = 24;
const DEFAULT_MAX_LONG_TASK_SAMPLES = 16;
const DEFAULT_MAX_INTERACTION_SAMPLES = 16;
const MAX_RENDERED_CHARS = 1_000_000;
const MAX_DURATION_MS = 60_000;
const MAX_STAGE_LENGTH = 80;
const SAFE_INTERACTION_NAMES = new Set([
  "click",
  "keydown",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchend",
  "touchstart",
]);
const SAFE_NAVIGATION_TYPES = new Set(["back_forward", "navigate", "prerender", "reload"]);

function readGlobalValue(name) {
  return typeof globalThis === "object" && globalThis ? globalThis[name] : undefined;
}

function normalizePositiveInt(value, fallback, maximum) {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return fallback;
  }
  return Math.min(maximum, Math.floor(Number(value)));
}

function normalizeDuration(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(Number(value) * 100) / 100));
}

function normalizeRenderedChars(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_RENDERED_CHARS, Math.max(0, Math.floor(Number(value))));
}

function normalizeStage(value) {
  const normalized = typeof value === "string" ? value.trim().slice(0, MAX_STAGE_LENGTH) : "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized) ? normalized : "unknown";
}

function normalizeRenderKind(value) {
  return value === "final" ? "final" : "delta";
}

function boundedPush(values, value, maxEntries) {
  values.push(value);
  if (values.length > maxEntries) {
    values.splice(0, values.length - maxEntries);
  }
}

function percentile(values, percentileValue) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return normalizeDuration(sorted[index]);
}

function summarizeDurations(samples) {
  const durations = samples.map((sample) => sample.durationMs);
  return {
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations.length > 0 ? normalizeDuration(Math.max(...durations)) : undefined,
  };
}

function readNow(performanceApi) {
  return typeof performanceApi?.now === "function" ? performanceApi.now() : Date.now();
}

function readNavigationSnapshot(performanceApi) {
  const navigation = typeof performanceApi?.getEntriesByType === "function"
    ? performanceApi.getEntriesByType("navigation")?.[0]
    : undefined;
  if (!navigation || typeof navigation !== "object") {
    return undefined;
  }
  const navigationType = SAFE_NAVIGATION_TYPES.has(navigation.type) ? navigation.type : "unknown";
  return {
    type: navigationType,
    domInteractiveMs: normalizeDuration(navigation.domInteractive),
    domContentLoadedEndMs: normalizeDuration(navigation.domContentLoadedEventEnd),
    loadEventEndMs: normalizeDuration(navigation.loadEventEnd),
    durationMs: normalizeDuration(navigation.duration),
    transferSize: normalizeRenderedChars(navigation.transferSize),
    decodedBodySize: normalizeRenderedChars(navigation.decodedBodySize),
  };
}

function cloneTimedSamples(samples) {
  return samples.map((sample) => ({ ...sample }));
}

/**
 * 仅保留当前页面的有界性能数字，避免把消息内容、URL 或 DOM 内容带入诊断面。
 */
export function createWebchatPerformanceObservability({
  startup = readGlobalValue("__SS_WEBCHAT_STARTUP__"),
  performanceApi = readGlobalValue("performance"),
  PerformanceObserverCtor = readGlobalValue("PerformanceObserver"),
  now = () => readNow(performanceApi),
  maxStartupMarks = DEFAULT_MAX_STARTUP_MARKS,
  maxRenderSamples = DEFAULT_MAX_RENDER_SAMPLES,
  maxLongTaskSamples = DEFAULT_MAX_LONG_TASK_SAMPLES,
  maxInteractionSamples = DEFAULT_MAX_INTERACTION_SAMPLES,
} = {}) {
  const startupMarkLimit = normalizePositiveInt(maxStartupMarks, DEFAULT_MAX_STARTUP_MARKS, 64);
  const renderSampleLimit = normalizePositiveInt(maxRenderSamples, DEFAULT_MAX_RENDER_SAMPLES, 64);
  const longTaskSampleLimit = normalizePositiveInt(maxLongTaskSamples, DEFAULT_MAX_LONG_TASK_SAMPLES, 64);
  const interactionSampleLimit = normalizePositiveInt(maxInteractionSamples, DEFAULT_MAX_INTERACTION_SAMPLES, 64);
  const startupMarks = [];
  const renderSamples = [];
  const longTaskSamples = [];
  const interactionSamples = [];
  const navigation = readNavigationSnapshot(performanceApi);
  const startupBaseMs = Number.isFinite(startup?.parseStartedAtMs) ? Number(startup.parseStartedAtMs) : undefined;
  let startupMarkCount = 0;
  let renderCount = 0;
  let totalRenderedChars = 0;
  let longTaskCount = 0;
  let interactionCount = 0;
  let startupUnsubscribe;
  let longTaskObserver;
  let interactionObserver;
  let userTimingSequence = 0;
  let running = false;

  function recordStartupMark(entry) {
    const stage = normalizeStage(entry?.stage);
    const atMs = Number.isFinite(entry?.atMs) ? Number(entry.atMs) : now();
    const elapsedMs = startupBaseMs === undefined ? undefined : normalizeDuration(atMs - startupBaseMs);
    boundedPush(startupMarks, {
      stage,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    }, startupMarkLimit);
    startupMarkCount += 1;
  }

  function captureExistingStartupMarks() {
    const marks = Array.isArray(startup?.marks) ? startup.marks : [];
    for (const mark of marks.slice(-startupMarkLimit)) {
      recordStartupMark(mark);
    }
  }

  function beginUserTiming(name) {
    if (typeof performanceApi?.mark !== "function" || typeof performanceApi?.measure !== "function") {
      return undefined;
    }
    userTimingSequence += 1;
    const prefix = `ss-webchat-${name}-${userTimingSequence}`;
    const startMark = `${prefix}-start`;
    const endMark = `${prefix}-end`;
    try {
      performanceApi.mark(startMark);
      return { startMark, endMark, measureName: `${prefix}-measure` };
    } catch {
      return undefined;
    }
  }

  function endUserTiming(timing) {
    if (!timing) return;
    try {
      performanceApi.mark(timing.endMark);
      performanceApi.measure(timing.measureName, timing.startMark, timing.endMark);
    } catch {
      // User Timing API 不可用时仍保留本地数值采样。
    } finally {
      try {
        performanceApi.clearMarks?.(timing.startMark);
        performanceApi.clearMarks?.(timing.endMark);
        performanceApi.clearMeasures?.(timing.measureName);
      } catch {
        // 清理失败不影响页面渲染。
      }
    }
  }

  function recordStreamingRender({ kind, renderedChars, durationMs } = {}) {
    const sample = {
      kind: normalizeRenderKind(kind),
      renderedChars: normalizeRenderedChars(renderedChars),
      durationMs: normalizeDuration(durationMs),
    };
    boundedPush(renderSamples, sample, renderSampleLimit);
    renderCount += 1;
    totalRenderedChars = Math.min(MAX_RENDERED_CHARS * 64, totalRenderedChars + sample.renderedChars);
    return { ...sample };
  }

  function measureStreamingRender(input, render) {
    const timing = beginUserTiming("stream-render");
    const startedAt = now();
    try {
      return typeof render === "function" ? render() : undefined;
    } finally {
      const durationMs = normalizeDuration(now() - startedAt);
      endUserTiming(timing);
      recordStreamingRender({ ...input, durationMs });
    }
  }

  function recordLongTask(entry) {
    boundedPush(longTaskSamples, {
      durationMs: normalizeDuration(entry?.duration),
    }, longTaskSampleLimit);
    longTaskCount += 1;
  }

  function recordInteraction(entry) {
    const name = SAFE_INTERACTION_NAMES.has(entry?.name) ? entry.name : "other";
    boundedPush(interactionSamples, {
      name,
      durationMs: normalizeDuration(entry?.duration),
    }, interactionSampleLimit);
    interactionCount += 1;
  }

  function createObserver(type, onEntry, options = {}) {
    if (typeof PerformanceObserverCtor !== "function") {
      return undefined;
    }
    let observer;
    try {
      observer = new PerformanceObserverCtor((list) => {
        const entries = typeof list?.getEntries === "function" ? list.getEntries() : [];
        for (const entry of entries) {
          onEntry(entry);
        }
      });
      observer.observe({ type, buffered: true, ...options });
      return observer;
    } catch {
      try {
        observer?.disconnect?.();
      } catch {
        // Unsupported observer 仅静默降级。
      }
      return undefined;
    }
  }

  function start() {
    if (running) return;
    running = true;
    captureExistingStartupMarks();
    if (typeof startup?.subscribe === "function") {
      try {
        startupUnsubscribe = startup.subscribe((entry) => recordStartupMark(entry));
      } catch {
        startupUnsubscribe = undefined;
      }
    }
    longTaskObserver = createObserver("longtask", recordLongTask);
    interactionObserver = createObserver("event", recordInteraction, { durationThreshold: 16 });
  }

  function dispose() {
    if (typeof startupUnsubscribe === "function") {
      try {
        startupUnsubscribe();
      } catch {
        // 订阅清理失败不能阻塞 pagehide。
      }
    }
    startupUnsubscribe = undefined;
    for (const observer of [longTaskObserver, interactionObserver]) {
      try {
        observer?.disconnect?.();
      } catch {
        // Observer 可能已被浏览器销毁。
      }
    }
    longTaskObserver = undefined;
    interactionObserver = undefined;
    running = false;
  }

  function getSummary() {
    const streaming = summarizeDurations(renderSamples);
    const longTasks = summarizeDurations(longTaskSamples);
    const interactions = summarizeDurations(interactionSamples);
    return {
      available: true,
      sampling: {
        running,
        maxStartupMarks: startupMarkLimit,
        maxRenderSamples: renderSampleLimit,
        maxLongTaskSamples: longTaskSampleLimit,
        maxInteractionSamples: interactionSampleLimit,
      },
      startup: {
        markCount: startupMarkCount,
        marks: startupMarks.map((mark) => ({ ...mark })),
        ...(navigation ? { navigation: { ...navigation } } : {}),
      },
      streaming: {
        renderCount,
        totalRenderedChars,
        ...streaming,
        recent: cloneTimedSamples(renderSamples.slice(-4)),
      },
      longTasks: {
        supported: Boolean(longTaskObserver),
        count: longTaskCount,
        ...longTasks,
        recent: cloneTimedSamples(longTaskSamples.slice(-4)),
      },
      interactions: {
        supported: Boolean(interactionObserver),
        count: interactionCount,
        ...interactions,
        recent: cloneTimedSamples(interactionSamples.slice(-4)),
      },
    };
  }

  return {
    start,
    dispose,
    measureStreamingRender,
    recordStreamingRender,
    getSummary,
  };
}
