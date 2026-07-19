export const RUNTIME_DEPENDENCY_REPORT_TARGET_SCHEMA_VERSION =
  "runtime-dependency-report-target/v1";

function requireTargetToken(value, label) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized || !/^[a-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid runtime dependency report ${label}: ${String(value)}`);
  }
  return normalized;
}

export function createRuntimeDependencyReportTarget({ mode, platform, arch, nodeAbi }) {
  const normalizedMode = requireTargetToken(mode, "mode");
  if (normalizedMode !== "slim" && normalizedMode !== "full") {
    throw new Error(`Invalid runtime dependency report mode: ${normalizedMode}`);
  }

  return Object.freeze({
    schemaVersion: RUNTIME_DEPENDENCY_REPORT_TARGET_SCHEMA_VERSION,
    mode: normalizedMode,
    platform: requireTargetToken(platform, "platform"),
    arch: requireTargetToken(arch, "arch"),
    nodeAbi: requireTargetToken(nodeAbi, "nodeAbi"),
  });
}
