const REQUIRED_EXPORTS = [
  "buildDoctorChatSummary",
  "disposeDoctorObservabilityCardRendering",
  "renderDoctorObservabilityCards",
];

function validateDoctorObservabilityModule(module) {
  if (!module || REQUIRED_EXPORTS.some((name) => typeof module[name] !== "function")) {
    throw new Error("Doctor observability module is unavailable.");
  }
  return module;
}

export function createDoctorObservabilityLoader({
  loadModule = () => import("./doctor-observability.js"),
} = {}) {
  let loadedModule = null;
  let pendingLoad = null;

  async function load() {
    if (loadedModule) return;
    if (!pendingLoad) {
      pendingLoad = Promise.resolve()
        .then(() => loadModule())
        .then((module) => {
          loadedModule = validateDoctorObservabilityModule(module);
        })
        .finally(() => {
          pendingLoad = null;
        });
    }
    return pendingLoad;
  }

  async function buildChatSummary(payload, t) {
    await load();
    return loadedModule.buildDoctorChatSummary(payload, t);
  }

  function render(container, payload, t, handlers = {}) {
    if (!loadedModule) return false;
    loadedModule.renderDoctorObservabilityCards(container, payload, t, handlers);
    return true;
  }

  function dispose(container) {
    if (!loadedModule) return false;
    loadedModule.disposeDoctorObservabilityCardRendering(container);
    return true;
  }

  return {
    buildChatSummary,
    dispose,
    load,
    render,
  };
}

export const doctorObservabilityLoader = createDoctorObservabilityLoader();

export async function buildLazyDoctorChatSummary(
  payload,
  t,
  { loader = doctorObservabilityLoader } = {},
) {
  try {
    return {
      ok: true,
      lines: await loader.buildChatSummary(payload, t),
    };
  } catch {
    return { ok: false, lines: [] };
  }
}
