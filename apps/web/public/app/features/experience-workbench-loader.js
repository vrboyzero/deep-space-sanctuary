const REQUIRED_FEATURE_METHODS = [
  "bindUi",
  "dispose",
  "loadExperienceWorkbench",
  "openExperienceWorkbench",
  "refreshExperienceWorkbenchForAgentSwitch",
  "setViewActive",
  "syncExperienceWorkbenchHeaderTitle",
];

function validateModule(module) {
  if (typeof module?.createExperienceWorkbenchFeature !== "function") {
    throw new Error("Experience workbench module is unavailable.");
  }
  return module;
}

function validateFeature(feature) {
  if (!feature || REQUIRED_FEATURE_METHODS.some((name) => typeof feature[name] !== "function")) {
    throw new Error("Experience workbench feature contract is unavailable.");
  }
  return feature;
}

export function createExperienceWorkbenchLazyOwner({
  createOptions,
  loadModule = () => import("./experience-workbench.js"),
  onFeatureCreated,
  onFeatureDisposed,
} = {}) {
  let feature = null;
  let pendingLoad = null;
  let disposed = false;

  async function load() {
    if (disposed) return undefined;
    if (feature) return feature;
    if (!pendingLoad) {
      pendingLoad = Promise.resolve(loadModule())
        .then((module) => {
          if (disposed) return undefined;
          const createdFeature = validateFeature(
            validateModule(module).createExperienceWorkbenchFeature(createOptions),
          );
          createdFeature.bindUi();
          if (disposed) {
            createdFeature.dispose();
            return undefined;
          }
          feature = createdFeature;
          onFeatureCreated?.(createdFeature);
          return createdFeature;
        })
        .finally(() => {
          pendingLoad = null;
        });
    }
    return pendingLoad;
  }

  async function loadExperienceWorkbench(forceSelectFirst = false) {
    const loadedFeature = await load();
    return loadedFeature?.loadExperienceWorkbench(forceSelectFirst);
  }

  async function openExperienceWorkbench(options = {}) {
    const loadedFeature = await load();
    return loadedFeature?.openExperienceWorkbench(options);
  }

  async function refreshExperienceWorkbenchForAgentSwitch(agentId) {
    if (disposed || !feature) return undefined;
    return feature.refreshExperienceWorkbenchForAgentSwitch(agentId);
  }

  function setViewActive(active) {
    if (disposed || !feature) return false;
    feature.setViewActive(active);
    return true;
  }

  function syncExperienceWorkbenchHeaderTitle() {
    if (disposed || !feature) return false;
    feature.syncExperienceWorkbenchHeaderTitle();
    return true;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    feature?.dispose();
    feature = null;
    onFeatureDisposed?.();
    return true;
  }

  function getRuntimeSnapshot() {
    return {
      loaded: Boolean(feature),
      loading: Boolean(pendingLoad),
      disposed,
      feature: feature?.getRuntimeSnapshot?.() ?? null,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    load,
    loadExperienceWorkbench,
    openExperienceWorkbench,
    refreshExperienceWorkbenchForAgentSwitch,
    setViewActive,
    syncExperienceWorkbenchHeaderTitle,
  };
}
