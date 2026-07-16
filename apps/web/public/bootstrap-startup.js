(() => {
  const perfNow = () =>
    typeof window.performance?.now === "function" ? window.performance.now() : Date.now();
  const startup = window.__SS_WEBCHAT_STARTUP__ = window.__SS_WEBCHAT_STARTUP__ || {
    navigationStartMs: Date.now(),
    parseStartedAtMs: perfNow(),
    marks: [],
  };
  const mark = (stage, extra = {}) => {
    const entry = {
      stage,
      atMs: perfNow(),
      ...extra,
    };
    startup.marks.push(entry);
    try {
      console.info("[WebChat startup]", stage, entry);
    } catch {
      // 控制台不可用不应阻塞首屏初始化。
    }
    return entry;
  };
  startup.mark = mark;
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
    document.documentElement.style.colorScheme = nextTheme === "light" ? "light" : "dark";
  } catch {
    document.documentElement.dataset.locale = FALLBACK_LOCALE;
    document.documentElement.lang = FALLBACK_LOCALE;
    document.documentElement.dataset.theme = FALLBACK_THEME;
    document.documentElement.style.colorScheme = FALLBACK_THEME;
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
      referrer: typeof document.referrer === "string" ? document.referrer : "",
    });
  }, { once: true });
  window.addEventListener("load", () => {
    mark("window.load");
  }, { once: true });
  mark("index.inline-bootstrap.end");
})();
