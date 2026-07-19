const VALID_THEMES = Object.freeze(["dark", "light"]);
const TRANSITION_CLASS = "theme-transitioning";
const TRANSITION_MS = 240;

function normalizeTheme(theme, fallbackTheme) {
  return VALID_THEMES.includes(theme) ? theme : fallbackTheme;
}

function readStoredTheme(storageKey) {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredTheme(storageKey, theme) {
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // ignore storage failures
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
}

function getNextTheme(theme) {
  return theme === "light" ? "dark" : "light";
}

function updateToggleButton(toggleButtonEl, activeTheme, translate) {
  if (!toggleButtonEl) return;

  const nextTheme = getNextTheme(activeTheme);
  toggleButtonEl.dataset.theme = activeTheme;
  toggleButtonEl.textContent = nextTheme === "light"
    ? translate("theme.lightLabel", {}, "Light")
    : translate("theme.darkLabel", {}, "Dark");
  toggleButtonEl.title = nextTheme === "light"
    ? translate("theme.toggleToLight", {}, "Switch to light theme")
    : translate("theme.toggleToDark", {}, "Switch to dark theme");
  toggleButtonEl.setAttribute("aria-label", toggleButtonEl.title);
}

export function createThemeController({
  storageKey = "ss-webchat-theme",
  defaultTheme = "dark",
  toggleButtonEl,
  translate = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const fallbackTheme = normalizeTheme(defaultTheme, "dark");
  let activeTheme = normalizeTheme(
    document.documentElement.dataset.theme || readStoredTheme(storageKey),
    fallbackTheme,
  );
  let transitionTimer = null;
  let disposed = false;

  applyTheme(activeTheme);
  updateToggleButton(toggleButtonEl, activeTheme, translate);

  function runThemeTransition(callback) {
    const root = document.documentElement;
    if (transitionTimer !== null) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    root.classList.add(TRANSITION_CLASS);
    void root.offsetWidth;
    callback();
    transitionTimer = window.setTimeout(() => {
      transitionTimer = null;
      if (disposed) return;
      root.classList.remove(TRANSITION_CLASS);
    }, TRANSITION_MS);
  }

  function setTheme(nextTheme, options = {}) {
    if (disposed) return activeTheme;
    const normalizedTheme = normalizeTheme(nextTheme, fallbackTheme);
    const shouldTransition = options.transition !== false && normalizedTheme !== activeTheme;

    const applyNextTheme = () => {
      activeTheme = normalizedTheme;
      applyTheme(activeTheme);
      updateToggleButton(toggleButtonEl, activeTheme, translate);
      writeStoredTheme(storageKey, activeTheme);
    };

    if (shouldTransition) {
      runThemeTransition(applyNextTheme);
    } else {
      applyNextTheme();
    }

    return activeTheme;
  }

  function toggle() {
    if (disposed) return activeTheme;
    return setTheme(getNextTheme(activeTheme));
  }

  function handleToggleClick() {
    toggle();
  }

  toggleButtonEl?.addEventListener("click", handleToggleClick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (transitionTimer !== null) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    document.documentElement.classList.remove(TRANSITION_CLASS);
    toggleButtonEl?.removeEventListener("click", handleToggleClick);
  }

  function getRuntimeSnapshot() {
    return {
      activeTimerCount: transitionTimer === null ? 0 : 1,
      listenerCount: disposed || !toggleButtonEl ? 0 : 1,
      disposed,
    };
  }

  return {
    dispose,
    getAvailableThemes: () => [...VALID_THEMES],
    getRuntimeSnapshot,
    getTheme: () => activeTheme,
    refreshLabels: () => {
      if (!disposed) updateToggleButton(toggleButtonEl, activeTheme, translate);
    },
    setTheme,
    toggle,
  };
}
