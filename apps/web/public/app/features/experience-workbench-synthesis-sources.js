function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function createExperienceWorkbenchSynthesisSourcesFeature({
  root,
  escapeHtml = (value) => String(value ?? ""),
  onSelectionChange,
} = {}) {
  let availableSourceIds = [];
  let selectedSourceIds = new Set();
  let relationBySourceId = new Map();
  let seedSourceId = "";
  let maxRelatedSourceCount = 0;
  let initialized = false;
  let bound = false;
  let disposed = false;

  function resetSelectionState() {
    availableSourceIds = [];
    selectedSourceIds = new Set();
    relationBySourceId = new Map();
    seedSourceId = "";
    maxRelatedSourceCount = 0;
    initialized = false;
  }

  function setPreview(preview) {
    if (disposed || !preview || typeof preview !== "object") return;
    const items = Array.isArray(preview.items) ? preview.items : [];
    const requestedSourceIds = Array.isArray(preview.sourceCandidateIds)
      ? preview.sourceCandidateIds
      : [];
    seedSourceId = normalizeText(preview.seedCandidate?.id) || normalizeText(requestedSourceIds[0]);
    relationBySourceId = new Map(items.map((item) => [
      normalizeText(item?.candidateId),
      normalizeText(item?.relation).toLowerCase(),
    ]).filter(([candidateId]) => candidateId));
    availableSourceIds = dedupeStrings([
      seedSourceId,
      ...items.map((item) => item?.candidateId),
      ...requestedSourceIds,
    ]);
    const configuredMax = Number(preview.maxSimilarSourceCount);
    maxRelatedSourceCount = Number.isFinite(configuredMax) && configuredMax >= 0
      ? Math.floor(configuredMax)
      : Math.max(0, availableSourceIds.length - (seedSourceId ? 1 : 0));

    const requestedSelection = new Set(dedupeStrings(requestedSourceIds));
    selectedSourceIds = new Set();
    if (seedSourceId) selectedSourceIds.add(seedSourceId);
    for (const candidateId of availableSourceIds) {
      if (candidateId === seedSourceId || !requestedSelection.has(candidateId)) continue;
      if (selectedSourceIds.size - (seedSourceId ? 1 : 0) >= maxRelatedSourceCount) break;
      selectedSourceIds.add(candidateId);
    }
    if (requestedSelection.size === 0) {
      for (const candidateId of availableSourceIds) {
        if (candidateId === seedSourceId) continue;
        if (selectedSourceIds.size - (seedSourceId ? 1 : 0) >= maxRelatedSourceCount) break;
        selectedSourceIds.add(candidateId);
      }
    }
    initialized = true;
  }

  function getSelectedSourceIds() {
    if (disposed || !initialized) return [];
    return availableSourceIds.filter((candidateId) => selectedSourceIds.has(candidateId));
  }

  function getSelectionSnapshot() {
    const selectedIds = getSelectedSourceIds();
    let selectedSameFamilyCount = 0;
    let selectedSimilarCount = 0;
    for (const candidateId of selectedIds) {
      if (candidateId === seedSourceId) continue;
      if (relationBySourceId.get(candidateId) === "same_family") {
        selectedSameFamilyCount += 1;
      } else {
        selectedSimilarCount += 1;
      }
    }
    return {
      availableSourceCount: disposed ? 0 : availableSourceIds.length,
      selectedSourceCount: selectedIds.length,
      selectedSameFamilyCount,
      selectedSimilarCount,
      maxRelatedSourceCount: disposed ? 0 : maxRelatedSourceCount,
      initialized: initialized && !disposed,
      bound,
      disposed,
    };
  }

  function renderCheckbox({ candidateId, label, disabled = false } = {}) {
    const normalizedCandidateId = normalizeText(candidateId);
    if (!normalizedCandidateId || !availableSourceIds.includes(normalizedCandidateId)) return "";
    const selected = selectedSourceIds.has(normalizedCandidateId);
    const required = normalizedCandidateId === seedSourceId;
    const selectedRelatedCount = selectedSourceIds.size - (seedSourceId && selectedSourceIds.has(seedSourceId) ? 1 : 0);
    const capacityReached = !selected && selectedRelatedCount >= maxRelatedSourceCount;
    const inputDisabled = disabled || required || capacityReached || disposed;
    const safeLabel = escapeHtml(normalizeText(label));
    return `
      <label class="experience-synthesis-source-select${required ? " is-required" : ""}">
        <input
          type="checkbox"
          data-synthesis-source-id="${escapeHtml(normalizedCandidateId)}"
          aria-label="${safeLabel}"
          ${selected ? "checked" : ""}
          ${inputDisabled ? "disabled" : ""}
        />
        <span>${safeLabel}</span>
      </label>
    `;
  }

  function handleChange(event) {
    if (disposed) return;
    const target = event?.target;
    const candidateId = normalizeText(target?.getAttribute?.("data-synthesis-source-id"));
    if (!candidateId || !availableSourceIds.includes(candidateId)) return;
    if (candidateId === seedSourceId) {
      target.checked = true;
      return;
    }
    if (target.checked) {
      const selectedRelatedCount = selectedSourceIds.size - (seedSourceId && selectedSourceIds.has(seedSourceId) ? 1 : 0);
      if (selectedRelatedCount >= maxRelatedSourceCount) {
        target.checked = false;
        return;
      }
      selectedSourceIds.add(candidateId);
    } else {
      selectedSourceIds.delete(candidateId);
    }
    const scrollTop = Number(root?.scrollTop || 0);
    onSelectionChange?.();
    if (root) root.scrollTop = scrollTop;
  }

  function bind() {
    if (disposed || bound || !root) return;
    root.addEventListener("change", handleChange);
    bound = true;
  }

  function clear() {
    if (disposed) return;
    resetSelectionState();
  }

  function dispose() {
    if (disposed) return;
    if (bound && root) root.removeEventListener("change", handleChange);
    bound = false;
    resetSelectionState();
    disposed = true;
  }

  return {
    bind,
    clear,
    dispose,
    getSelectedSourceIds,
    getSelectionSnapshot,
    renderCheckbox,
    setPreview,
  };
}
