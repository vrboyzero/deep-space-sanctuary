const EVIDENCE_SCHEMA_VERSION = "verification-impact-evidence/v1";
const SOURCE_CONTRACTS = new Map([
  ["code-intel-reference", "code-intel/v1"],
  ["project-dependency", "project-dependency/v1"],
]);
const MAX_IMPACTED_PATHS = 512;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, allowedKeys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  assert(unexpected.length === 0, `${label} contains unsupported fields: ${unexpected.join(", ")}.`);
}

function normalizeId(value, label) {
  assert(typeof value === "string" && value.length <= 160 && ID_PATTERN.test(value), `${label} must be a safe id.`);
  return value;
}

function normalizeRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 1000, `${label} must be a safe relative path.`);
  assert(!value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:\//.test(value), `${label} must be a safe relative path.`);
  const segments = value.split("/");
  assert(segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."), `${label} must be a safe relative path.`);
  assert(!value.includes("*"), `${label} must be a concrete path.`);
  return value;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeRevision(value, label) {
  assertExactKeys(value, ["commit", "workspaceHash"], label);
  assert(typeof value.commit === "string" && COMMIT_PATTERN.test(value.commit), `${label}.commit must identify a source revision.`);
  assert(typeof value.workspaceHash === "string" && SHA256_PATTERN.test(value.workspaceHash), `${label}.workspaceHash must be a SHA-256.`);
  return { commit: value.commit, workspaceHash: value.workspaceHash };
}

function normalizeArtifact(value, label) {
  assertExactKeys(value, ["path", "sha256"], label);
  const artifactPath = normalizeRelativePath(value.path, `${label}.path`);
  assert(typeof value.sha256 === "string" && SHA256_PATTERN.test(value.sha256), `${label}.sha256 must be a SHA-256.`);
  return { path: artifactPath, sha256: value.sha256 };
}

export function normalizeVerificationImpactEvidence(value, { changedPaths = [], revision = null } = {}) {
  if (value === undefined || value === null) {
    return {
      projection: null,
      completeChangedPaths: [],
      partialChangedPaths: [],
      impactedPaths: [],
      hasPartial: false,
    };
  }
  assertExactKeys(value, ["schemaVersion", "revision", "sources", "coverage"], "impactEvidence");
  assert(value.schemaVersion === EVIDENCE_SCHEMA_VERSION, "Unsupported impact evidence schemaVersion.");
  const normalizedRevision = normalizeRevision(value.revision, "impactEvidence.revision");
  assert(revision && normalizedRevision.commit === revision.commit && normalizedRevision.workspaceHash === revision.workspaceHash, "impactEvidence revision does not match the verification revision.");
  const normalizedChangedPaths = sortedUnique(changedPaths.map((entry, index) => normalizeRelativePath(entry, `changedPaths[${index}]`)));
  assert(Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 16, "impactEvidence.sources must contain 1-16 sources.");
  const sourceIds = new Set();
  const sources = value.sources.map((source, index) => {
    const label = `impactEvidence.sources[${index}]`;
    assertExactKeys(source, ["id", "kind", "contractVersion", "status", "artifact"], label);
    const id = normalizeId(source.id, `${label}.id`);
    assert(!sourceIds.has(id), `impactEvidence.sources contains duplicate id: ${id}.`);
    sourceIds.add(id);
    assert(SOURCE_CONTRACTS.get(source.kind) === source.contractVersion, `${label}.kind and contractVersion are inconsistent.`);
    assert(source.status === "complete" || source.status === "partial", `${label}.status is unsupported.`);
    return {
      id,
      kind: source.kind,
      contractVersion: source.contractVersion,
      status: source.status,
      artifact: normalizeArtifact(source.artifact, `${label}.artifact`),
    };
  });
  assert(Array.isArray(value.coverage) && value.coverage.length > 0 && value.coverage.length <= 256, "impactEvidence.coverage must contain 1-256 entries.");
  const coveragePaths = new Set();
  let impactedPathCount = 0;
  const coverage = value.coverage.map((entry, index) => {
    const label = `impactEvidence.coverage[${index}]`;
    assertExactKeys(entry, ["changedPath", "status", "sourceIds", "impactedPaths"], label);
    const changedPath = normalizeRelativePath(entry.changedPath, `${label}.changedPath`);
    assert(normalizedChangedPaths.includes(changedPath), `${label}.changedPath must be one of changedPaths.`);
    assert(!coveragePaths.has(changedPath), `impactEvidence.coverage contains duplicate changedPath: ${changedPath}.`);
    coveragePaths.add(changedPath);
    assert(entry.status === "complete" || entry.status === "partial", `${label}.status is unsupported.`);
    assert(Array.isArray(entry.sourceIds) && entry.sourceIds.length > 0 && entry.sourceIds.length <= 16, `${label}.sourceIds must contain 1-16 ids.`);
    const normalizedSourceIds = sortedUnique(entry.sourceIds.map((sourceId, sourceIndex) => normalizeId(sourceId, `${label}.sourceIds[${sourceIndex}]`)));
    assert(normalizedSourceIds.length === entry.sourceIds.length, `${label}.sourceIds must not contain duplicates.`);
    assert(normalizedSourceIds.every((sourceId) => sourceIds.has(sourceId)), `${label}.sourceIds references an unknown source.`);
    assert(Array.isArray(entry.impactedPaths) && entry.impactedPaths.length > 0 && entry.impactedPaths.length <= MAX_IMPACTED_PATHS, `${label}.impactedPaths must contain 1-${MAX_IMPACTED_PATHS} concrete paths.`);
    const impactedPaths = sortedUnique(entry.impactedPaths.map((impactPath, pathIndex) => normalizeRelativePath(impactPath, `${label}.impactedPaths[${pathIndex}]`)));
    assert(impactedPaths.length === entry.impactedPaths.length, `${label}.impactedPaths must not contain duplicates.`);
    if (entry.status === "complete") {
      assert(normalizedSourceIds.every((sourceId) => sources.find((source) => source.id === sourceId)?.status === "complete"), `${label} cannot be complete with a partial source.`);
    }
    impactedPathCount += impactedPaths.length;
    assert(impactedPathCount <= MAX_IMPACTED_PATHS, `impactEvidence exceeds ${MAX_IMPACTED_PATHS} total impacted paths.`);
    return { changedPath, status: entry.status, sourceIds: normalizedSourceIds, impactedPaths };
  });
  assert(sources.every((source) => coverage.some((entry) => entry.sourceIds.includes(source.id))), "impactEvidence contains an unused source.");
  const completeChangedPaths = coverage.filter((entry) => entry.status === "complete").map((entry) => entry.changedPath);
  const partialChangedPaths = coverage.filter((entry) => entry.status === "partial").map((entry) => entry.changedPath);
  const impactedPaths = sortedUnique(coverage.flatMap((entry) => entry.impactedPaths));
  return {
    projection: {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      revision: normalizedRevision,
      sources,
      coverage,
    },
    completeChangedPaths,
    partialChangedPaths,
    impactedPaths,
    hasPartial: partialChangedPaths.length > 0 || sources.some((source) => source.status === "partial"),
  };
}
