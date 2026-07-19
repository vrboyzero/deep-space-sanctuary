import { createPanelTaskScope } from "./panel-task-scope.js";

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
  const taskScope = createPanelTaskScope();
  const transitionTimerKey = Symbol("theme-transition");

  function runThemeTransition(callback) {
    const root = document.documentElement;
    taskScope.clearTimeout(transitionTimerKey);
    root.classList.add(TRANSITION_CLASS);
    void root.offsetWidth;
    callback();
    taskScope.replaceTimeout(transitionTimerKey, () => {
      root.classList.remove(TRANSITION_CLASS);
    }, TRANSITION_MS);
  }

  function setTheme(nextTheme, options = {}) {
    if (!taskScope.isActive()) return activeTheme;
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
    if (!taskScope.isActive()) return activeTheme;
    return setTheme(getNextTheme(activeTheme));
  }

  function handleToggleClick() {
    toggle();
  }

  function activate() {
    if (!taskScope.activate()) return false;
    applyTheme(activeTheme);
    updateToggleButton(toggleButtonEl, activeTheme, translate);
    taskScope.addEventListener(toggleButtonEl, "click", handleToggleClick);
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    document.documentElement.classList.remove(TRANSITION_CLASS);
    return true;
  }

  function dispose() {
    if (!taskScope.dispose()) return false;
    document.documentElement.classList.remove(TRANSITION_CLASS);
    return true;
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      activeTimerCount: snapshot.activeTimerCount,
      listenerCount: snapshot.listenerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getAvailableThemes: () => [...VALID_THEMES],
    getRuntimeSnapshot,
    getTheme: () => activeTheme,
    refreshLabels: () => {
      if (taskScope.isActive()) updateToggleButton(toggleButtonEl, activeTheme, translate);
    },
    setTheme,
    toggle,
  };
}
