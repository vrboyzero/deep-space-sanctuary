(() => {
  const MAX_STARTUP_MARKS = 64;
  const MAX_STARTUP_EXTRA_FIELDS = 16;
  const MAX_STARTUP_STAGE_LENGTH = 80;
  const perfNow = () =>
    typeof window.performance?.now === "function" ? window.performance.now() : Date.now();
  const startup = window.__SS_WEBCHAT_STARTUP__ = window.__SS_WEBCHAT_STARTUP__ || {
    navigationStartMs: Date.now(),
    parseStartedAtMs: perfNow(),
    marks: [],
  };
  const listeners = startup.__listeners instanceof Set ? startup.__listeners : new Set();
  startup.__listeners = listeners;

  const sanitizeStage = (stage) => {
    const normalized = typeof stage === "string" ? stage.trim().slice(0, MAX_STARTUP_STAGE_LENGTH) : "";
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized) ? normalized : "unknown";
  };

  const sanitizeExtra = (extra) => {
    if (!extra || typeof extra !== "object") return {};
    const safe = {};
    for (const [key, value] of Object.entries(extra)) {
      if (Object.keys(safe).length >= MAX_STARTUP_EXTRA_FIELDS) break;
      if (key === "stage" || key === "atMs") continue;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(key)) continue;
      if (typeof value === "boolean") {
        safe[key] = value;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        safe[key] = Math.round(value * 100) / 100;
      }
    }
    return safe;
  };

  const createMarkEntry = (stage, atMs, extra = {}) => ({
    stage: sanitizeStage(stage),
    atMs: typeof atMs === "number" && Number.isFinite(atMs) ? Math.round(atMs * 100) / 100 : perfNow(),
    ...sanitizeExtra(extra),
  });

  // 旧页面或第三方脚本预填的标记同样不能把 URL、正文或任意对象留在全局诊断缓冲区。
  startup.marks = Array.isArray(startup.marks)
    ? startup.marks.slice(-MAX_STARTUP_MARKS).map((entry) => createMarkEntry(entry?.stage, entry?.atMs, entry))
    : [];

  const mark = (stage, extra = {}) => {
    const entry = createMarkEntry(stage, perfNow(), extra);
    startup.marks.push(entry);
    if (startup.marks.length > MAX_STARTUP_MARKS) {
      startup.marks.splice(0, startup.marks.length - MAX_STARTUP_MARKS);
    }
    for (const listener of listeners) {
      try {
        listener(entry);
      } catch {
        // 观测订阅失败不能影响首屏初始化。
      }
    }
    try {
      console.info("[WebChat startup]", stage, entry);
    } catch {
      // 控制台不可用不应阻塞首屏初始化。
    }
    return entry;
  };
  startup.mark = mark;
  startup.subscribe = (listener) => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  mark("index.inline-bootstrap.start");

  const THEME_STORAGE_KEY = "ss-webchat-theme";
  const LOCALE_STORAGE_KEY = "ss-webchat-locale";
  const FALLBACK_THEME = "dark";
  const FALLBACK_LOCALE = "zh-CN";
  const VALID_THEMES = new Set(["dark", "light"]);
  const VALID_LOCALES = new Set(["zh-CN", "en-US"]);

  const normalizeLocale = (value) => {
    if (!value) return FALLBACK_LOCALE;
    if (VALID_LOCALES.has(value)) return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized.startsWith("zh")) return "zh-CN";
    if (normalized.startsWith("en")) return "en-US";
    return FALLBACK_LOCALE;
  };

  try {
    const urlLocale = new URLSearchParams(window.location.search).get("lang");
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    const nextLocale = normalizeLocale(urlLocale || storedLocale || window.navigator.language);
    document.documentElement.dataset.locale = nextLocale;
    document.documentElement.lang = nextLocale;

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = VALID_THEMES.has(storedTheme) ? storedTheme : FALLBACK_THEME;
    document.documentElement.dataset.theme = nextTheme;
  } catch {
    document.documentElement.dataset.locale = FALLBACK_LOCALE;
    document.documentElement.lang = FALLBACK_LOCALE;
    document.documentElement.dataset.theme = FALLBACK_THEME;
  }

  document.addEventListener("DOMContentLoaded", () => {
    mark("dom.content.loaded");
  }, { once: true });
  window.addEventListener("pageshow", (event) => {
    const navEntry = typeof window.performance?.getEntriesByType === "function"
      ? window.performance.getEntriesByType("navigation")?.[0]
      : null;
    mark("navigation.timing.snapshot", {
      navigationType: typeof navEntry?.type === "string" ? navEntry.type : "",
      domInteractiveMs: typeof navEntry?.domInteractive === "number" ? Math.round(navEntry.domInteractive) : null,
      domContentLoadedEndMs: typeof navEntry?.domContentLoadedEventEnd === "number"
        ? Math.round(navEntry.domContentLoadedEventEnd)
        : null,
      loadEventEndMs: typeof navEntry?.loadEventEnd === "number" ? Math.round(navEntry.loadEventEnd) : null,
      durationMs: typeof navEntry?.duration === "number" ? Math.round(navEntry.duration) : null,
      redirectCount: typeof navEntry?.redirectCount === "number" ? navEntry.redirectCount : null,
      transferSize: typeof navEntry?.transferSize === "number" ? navEntry.transferSize : null,
      decodedBodySize: typeof navEntry?.decodedBodySize === "number" ? navEntry.decodedBodySize : null,
      nextHopProtocol: typeof navEntry?.nextHopProtocol === "string" ? navEntry.nextHopProtocol : "",
      activationStartMs: typeof navEntry?.activationStart === "number" ? Math.round(navEntry.activationStart) : null,
      persisted: event?.persisted === true,
    });
  }, { once: true });
  window.addEventListener("load", () => {
    mark("window.load");
  }, { once: true });
  mark("index.inline-bootstrap.end");
})();
