const DEFAULT_LOCALE = "zh-CN";

function normalizePreferredLocale(locale, fallbackLocale, availableLocales) {
  if (typeof locale === "string" && availableLocales.includes(locale)) {
    return locale;
  }

  const normalized = typeof locale === "string" ? locale.trim().toLowerCase() : "";
  if (!normalized) return fallbackLocale;
  if (normalized.startsWith("zh")) return availableLocales.includes("zh-CN") ? "zh-CN" : fallbackLocale;
  if (normalized.startsWith("en")) return availableLocales.includes("en-US") ? "en-US" : fallbackLocale;
  return fallbackLocale;
}

function readStoredLocale(storageKey) {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredLocale(storageKey, locale) {
  try {
    window.localStorage.setItem(storageKey, locale);
  } catch {
    // ignore storage failures
  }
}

function getByPath(obj, path) {
  if (!obj || typeof obj !== "object" || !path) return undefined;
  return String(path)
    .split(".")
    .reduce((cur, segment) => (cur && typeof cur === "object" ? cur[segment] : undefined), obj);
}

function interpolate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return `{${key}}`;
  });
}

function applyLocaleToRoot(locale) {
  const root = document.documentElement;
  root.lang = locale;
  root.dataset.locale = locale;
}

export function createLocaleController({
  storageKey = "ss-webchat-locale",
  defaultLocale = DEFAULT_LOCALE,
  dictionaries = {},
  localeMeta = {},
} = {}) {
  const availableLocales = Object.keys(dictionaries);
  const fallbackLocale = normalizePreferredLocale(defaultLocale, DEFAULT_LOCALE, availableLocales);
  const subscribers = new Set();
  const boundSelectListeners = new Map();
  let localeChangeCount = 0;
  let disposed = false;

  let activeLocale = normalizePreferredLocale(
    document.documentElement.dataset.locale ||
      document.documentElement.lang ||
      readStoredLocale(storageKey) ||
      window.navigator.language,
    fallbackLocale,
    availableLocales,
  );

  function t(key, params = {}, fallback = key) {
    const localized = getByPath(dictionaries[activeLocale], key);
    const fallbackValue = getByPath(dictionaries[fallbackLocale], key);
    const template = localized ?? fallbackValue ?? fallback;
    return interpolate(template, params);
  }

  function applyStaticTranslations(root = document) {
    if (!root?.querySelectorAll) return;

    for (const el of root.querySelectorAll("[data-i18n]")) {
      const key = el.getAttribute("data-i18n");
      if (!key) continue;
      el.textContent = t(key);
    }

    for (const el of root.querySelectorAll("[data-i18n-title]")) {
      const key = el.getAttribute("data-i18n-title");
      if (!key) continue;
      el.title = t(key);
    }

    for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key) continue;
      el.setAttribute("placeholder", t(key));
    }

    for (const el of root.querySelectorAll("[data-i18n-aria-label]")) {
      const key = el.getAttribute("data-i18n-aria-label");
      if (!key) continue;
      el.setAttribute("aria-label", t(key));
    }

    const titleEl = document.querySelector("title[data-i18n]");
    if (titleEl) {
      document.title = t(titleEl.getAttribute("data-i18n"));
    }
  }

  function refreshBoundSelect(selectEl) {
    if (!selectEl) return;
    const currentValue = activeLocale;
    selectEl.innerHTML = availableLocales
      .map((locale) => {
        const meta = localeMeta[locale];
        const label = meta?.label || locale;
        return `<option value="${locale}">${label}</option>`;
      })
      .join("");
    selectEl.value = currentValue;
  }

  function notify() {
    if (disposed) return;
    applyStaticTranslations(document);
    for (const selectEl of boundSelectListeners.keys()) {
      refreshBoundSelect(selectEl);
    }
    for (const subscriber of subscribers) {
      subscriber(activeLocale);
    }
  }

  function setLocale(nextLocale, options = {}) {
    if (disposed) return activeLocale;
    const normalized = normalizePreferredLocale(nextLocale, fallbackLocale, availableLocales);
    if (normalized === activeLocale && options.force !== true) {
      return activeLocale;
    }
    const changed = normalized !== activeLocale;
    activeLocale = normalized;
    if (changed) localeChangeCount += 1;
    applyLocaleToRoot(activeLocale);
    writeStoredLocale(storageKey, activeLocale);
    notify();
    return activeLocale;
  }

  function bindSelect(selectEl) {
    if (disposed || !selectEl || boundSelectListeners.has(selectEl)) return;
    refreshBoundSelect(selectEl);
    const handleChange = () => {
      setLocale(selectEl.value);
    };
    boundSelectListeners.set(selectEl, handleChange);
    selectEl.addEventListener("change", handleChange);
  }

  function subscribe(listener) {
    if (disposed || typeof listener !== "function") return () => {};
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }

  function dispose() {
    if (disposed) return;
    for (const [selectEl, handleChange] of boundSelectListeners) {
      selectEl.removeEventListener("change", handleChange);
    }
    boundSelectListeners.clear();
    subscribers.clear();
    disposed = true;
  }

  function getRuntimeSnapshot() {
    return {
      subscriberCount: subscribers.size,
      boundSelectCount: boundSelectListeners.size,
      localeChangeCount,
      disposed,
    };
  }

  applyLocaleToRoot(activeLocale);
  applyStaticTranslations(document);

  return {
    applyStaticTranslations,
    bindSelect,
    getAvailableLocales: () => [...availableLocales],
    getLocale: () => activeLocale,
    getLocaleMeta: (locale = activeLocale) => localeMeta[locale] || { code: locale, label: locale },
    getSpeechRecognitionLocale: () => localeMeta[activeLocale]?.speechRecognitionLocale || activeLocale,
    setLocale,
    subscribe,
    dispose,
    getRuntimeSnapshot,
    t,
  };
}
