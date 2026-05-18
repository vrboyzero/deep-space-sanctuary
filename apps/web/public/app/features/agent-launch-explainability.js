function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function tr(t, key, params, fallback) {
  return typeof t === "function" ? t(key, params ?? {}, fallback) : fallback;
}

function compactJoin(parts) {
  return parts.filter(Boolean).join(", ");
}

function formatCatalogDefault(value, t) {
  const item = normalizeObject(value);
  if (!item) return "";
  const allowedFamilies = normalizeStringArray(item.allowedToolFamilies);
  const skills = normalizeStringArray(item.skills);
  const whenToUse = normalizeStringArray(item.whenToUse);
  const parts = [
    normalizeString(item.role) ? `role=${normalizeString(item.role)}` : "",
    normalizeString(item.permissionMode) ? `permission=${normalizeString(item.permissionMode)}` : "",
    allowedFamilies.length ? `families=${allowedFamilies.join("+")}` : "",
    normalizeString(item.maxToolRiskLevel) ? `risk=${normalizeString(item.maxToolRiskLevel)}` : "",
    normalizeString(item.handoffStyle) ? `handoff=${normalizeString(item.handoffStyle)}` : "",
    skills.length ? `skills=${skills.slice(0, 2).join("+")}${skills.length > 2 ? `+${skills.length - 2}` : ""}` : "",
    whenToUse.length ? `when=${whenToUse[0]}${whenToUse.length > 1 ? `+${whenToUse.length - 1}` : ""}` : "",
  ];
  if (!parts.some(Boolean)) return "";
  return `${tr(t, "launchExplainability.catalogDefault", {}, "catalog default")}: ${compactJoin(parts)}`;
}

function formatEffectiveLaunch(value, t) {
  const item = normalizeObject(value);
  if (!item) return "";
  const allowedFamilies = normalizeStringArray(item.allowedToolFamilies);
  const parts = [
    normalizeString(item.source) ? `source=${normalizeString(item.source)}` : "",
    normalizeString(item.agentId) ? `agent=${normalizeString(item.agentId)}` : "",
    normalizeString(item.profileId) ? `profile=${normalizeString(item.profileId)}` : "",
    normalizeString(item.role) ? `role=${normalizeString(item.role)}` : "",
    normalizeString(item.permissionMode) ? `permission=${normalizeString(item.permissionMode)}` : "",
    allowedFamilies.length ? `families=${allowedFamilies.join("+")}` : "",
    normalizeString(item.maxToolRiskLevel) ? `risk=${normalizeString(item.maxToolRiskLevel)}` : "",
    normalizeString(item.handoffStyle) ? `handoff=${normalizeString(item.handoffStyle)}` : "",
    normalizeString(item.policySummary) ? `policy=${normalizeString(item.policySummary)}` : "",
  ];
  if (!parts.some(Boolean)) return "";
  return `${tr(t, "launchExplainability.effectiveLaunch", {}, "effective launch")}: ${compactJoin(parts)}`;
}

function formatSuggestedLaunch(value, t) {
  const item = normalizeObject(value);
  if (!item) return "";
  const allowedFamilies = normalizeStringArray(item.allowedToolFamilies);
  const parts = [
    normalizeString(item.source) ? `source=${normalizeString(item.source)}` : "",
    normalizeString(item.agentId) ? `agent=${normalizeString(item.agentId)}` : "",
    normalizeString(item.profileId) ? `profile=${normalizeString(item.profileId)}` : "",
    normalizeString(item.role) ? `role=${normalizeString(item.role)}` : "",
    normalizeString(item.permissionMode) ? `permission=${normalizeString(item.permissionMode)}` : "",
    allowedFamilies.length ? `families=${allowedFamilies.join("+")}` : "",
    normalizeString(item.maxToolRiskLevel) ? `risk=${normalizeString(item.maxToolRiskLevel)}` : "",
    normalizeString(item.handoffStyle) ? `handoff=${normalizeString(item.handoffStyle)}` : "",
    normalizeString(item.policySummary) ? `policy=${normalizeString(item.policySummary)}` : "",
  ];
  if (!parts.some(Boolean)) return "";
  return `${tr(t, "launchExplainability.suggestedLaunch", {}, "suggested launch")}: ${compactJoin(parts)}`;
}

function formatDelegationReason(value, t) {
  const item = normalizeObject(value);
  if (!item) return "";
  const contextKeys = normalizeStringArray(item.contextKeys);
  const sourceAgentIds = normalizeStringArray(item.sourceAgentIds);
  const parts = [
    normalizeString(item.source) ? `source=${normalizeString(item.source)}` : "",
    normalizeString(item.intentKind) ? `intent=${normalizeString(item.intentKind)}` : "",
    normalizeString(item.intentSummary) ? `summary=${normalizeString(item.intentSummary)}` : "",
    normalizeString(item.expectedDeliverableSummary) ? `deliverable=${normalizeString(item.expectedDeliverableSummary)}` : "",
    normalizeString(item.aggregationMode) ? `aggregation=${normalizeString(item.aggregationMode)}` : "",
    contextKeys.length ? `context=${contextKeys.join("+")}` : "",
    sourceAgentIds.length ? `from=${sourceAgentIds.join("+")}` : "",
  ];
  if (!parts.some(Boolean)) return "";
  return `${tr(t, "launchExplainability.delegationReason", {}, "delegation reason")}: ${compactJoin(parts)}`;
}

function formatRuntimeResilience(value, t) {
  const item = normalizeObject(value);
  if (!item) return "";
  const compactionAuxVerdict = normalizeObject(item.compactionAuxSummaryVerdict);
  const parts = [
    normalizeString(item.alertLevel) ? `alert=${normalizeString(item.alertLevel)}/${normalizeString(item.alertCode) || "-"}` : "",
    normalizeString(item.alertMessage) ? `alert_note=${normalizeString(item.alertMessage)}` : "",
    normalizeString(item.dominantReason) ? `reason_focus=${normalizeString(item.dominantReason)}` : "",
    normalizeString(item.reasonClusterSummary) ? `reason_cluster=${normalizeString(item.reasonClusterSummary)}` : "",
    normalizeString(item.mixedSignalHint) ? `mixed_hint=${normalizeString(item.mixedSignalHint)}` : "",
    normalizeString(item.recoveryHint) ? `hint=${normalizeString(item.recoveryHint)}` : "",
    typeof item.configuredFallbackCount === "number" ? `fallbacks=${item.configuredFallbackCount}` : "",
    normalizeString(item.latestStatus) ? `latest=${normalizeString(item.latestStatus)}` : "",
    normalizeString(item.latestSignal) ? `signal=${normalizeString(item.latestSignal)}` : "",
    normalizeString(item.latestRoute) ? `route=${normalizeString(item.latestRoute)}` : "",
    normalizeString(item.latestRouteBehavior) ? `route_note=${normalizeString(item.latestRouteBehavior)}` : "",
    normalizeString(item.latestReasonSummary) ? `latest_reasons=${normalizeString(item.latestReasonSummary)}` : "",
    normalizeString(item.overallReasonSummary) ? `reasons=${normalizeString(item.overallReasonSummary)}` : "",
    normalizeString(item.totalsSummary) ? `totals=${normalizeString(item.totalsSummary)}` : "",
    normalizeString(item.compactionRoute) ? `compaction=${normalizeString(item.compactionRoute)}` : "",
    compactionAuxVerdict
      ? `compaction_aux=${compactJoin([
        normalizeString(compactionAuxVerdict.strategy),
        normalizeString(compactionAuxVerdict.reason),
        typeof compactionAuxVerdict.enabled === "boolean" ? `enabled=${compactionAuxVerdict.enabled ? "yes" : "no"}` : "",
      ].filter(Boolean))}`
      : "",
    normalizeString(item.latestHeadline) ? `note=${normalizeString(item.latestHeadline)}` : "",
  ];
  if (!parts.some(Boolean)) return "";
  return `${tr(t, "launchExplainability.runtimeResilience", {}, "runtime resilience")}: ${compactJoin(parts)}`;
}

export function buildLaunchExplainabilityLines(value, t) {
  const explainability = normalizeObject(value);
  if (!explainability) return [];
  return [
    formatCatalogDefault(explainability.catalogDefault, t),
    formatSuggestedLaunch(explainability.suggestedLaunch, t),
    formatEffectiveLaunch(explainability.effectiveLaunch, t),
    formatDelegationReason(explainability.delegationReason, t),
    formatRuntimeResilience(explainability.runtimeResilience, t),
  ].filter(Boolean);
}
