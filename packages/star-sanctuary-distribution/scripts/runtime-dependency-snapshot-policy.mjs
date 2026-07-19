import crypto from "node:crypto";

import { createRuntimeDependencyReportTarget } from "./runtime-dependency-target-policy.mjs";
import { normalizeRuntimeDependencyStoreSnapshot } from "./runtime-dependency-store-snapshot-policy.mjs";

export const RUNTIME_DEPENDENCY_SNAPSHOT_SCHEMA_VERSION = "runtime-dependency-snapshot/v3";
export const RUNTIME_DEPENDENCY_SNAPSHOT_ARTIFACT_SCHEMA_VERSION = "runtime-dependency-snapshot-artifact/v2";

const TARGET_FIELDS = ["schemaVersion", "mode", "platform", "arch", "nodeAbi"];
const ARTIFACT_IDENTITY_FIELDS = [
  "schemaVersion",
  "descriptorSchemaVersion",
  "descriptorSha256",
  "sourceLockfileSha256",
  "runtimeLockfileSha256",
  "runtimeWorkspaceConfigSha256",
];
const STORE_SNAPSHOT_FIELDS = ["schemaVersion", "fileCount", "totalSize", "entriesSha256"];

function hashSnapshotInput(value, label) {
  if (typeof value !== "string" && !ArrayBuffer.isView(value)) {
    throw new Error(`Invalid runtime dependency snapshot ${label} content`);
  }
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createRuntimeDependencySnapshot({
  target,
  sourceLockfile,
  runtimeLockfile,
  runtimeWorkspaceConfig,
  storeSnapshot,
}) {
  return Object.freeze({
    schemaVersion: RUNTIME_DEPENDENCY_SNAPSHOT_SCHEMA_VERSION,
    target: createRuntimeDependencyReportTarget(target),
    sourceLockfileSha256: hashSnapshotInput(sourceLockfile, "source lockfile"),
    runtimeLockfileSha256: hashSnapshotInput(runtimeLockfile, "runtime lockfile"),
    runtimeWorkspaceConfigSha256: hashSnapshotInput(runtimeWorkspaceConfig, "runtime workspace config"),
    storeSnapshot: normalizeRuntimeDependencyStoreSnapshot(storeSnapshot),
  });
}

export function assertRuntimeDependencySnapshot(snapshot, {
  target,
  sourceLockfile,
  runtimeLockfile,
  runtimeWorkspaceConfig,
  storeSnapshot,
}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Runtime dependency snapshot must be an object");
  }
  if (snapshot.schemaVersion !== RUNTIME_DEPENDENCY_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("Runtime dependency snapshot schemaVersion mismatch");
  }

  const expectedTarget = createRuntimeDependencyReportTarget(target);
  const targetMismatches = TARGET_FIELDS.filter(
    (field) => snapshot.target?.[field] !== expectedTarget[field],
  );
  if (targetMismatches.length > 0) {
    throw new Error(`Runtime dependency snapshot target mismatch: ${targetMismatches.join(", ")}`);
  }

  const expectedHashes = {
    sourceLockfileSha256: hashSnapshotInput(sourceLockfile, "source lockfile"),
    runtimeLockfileSha256: hashSnapshotInput(runtimeLockfile, "runtime lockfile"),
    runtimeWorkspaceConfigSha256: hashSnapshotInput(runtimeWorkspaceConfig, "runtime workspace config"),
  };
  const hashMismatches = Object.entries(expectedHashes)
    .filter(([field, expected]) => snapshot[field] !== expected)
    .map(([field]) => field);
  if (hashMismatches.length > 0) {
    throw new Error(`Runtime dependency snapshot content mismatch: ${hashMismatches.join(", ")}`);
  }
  const expectedStoreSnapshot = normalizeRuntimeDependencyStoreSnapshot(storeSnapshot);
  const storeMismatches = STORE_SNAPSHOT_FIELDS.filter(
    (field) => snapshot.storeSnapshot?.[field] !== expectedStoreSnapshot[field],
  );
  if (storeMismatches.length > 0) {
    throw new Error(
      `Runtime dependency snapshot store mismatch: ${storeMismatches.map((field) => `storeSnapshot.${field}`).join(", ")}`,
    );
  }
  return snapshot;
}

export function serializeRuntimeDependencySnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function createRuntimeDependencySnapshotArtifactIdentity(snapshot) {
  return Object.freeze({
    schemaVersion: RUNTIME_DEPENDENCY_SNAPSHOT_ARTIFACT_SCHEMA_VERSION,
    descriptorSchemaVersion: snapshot.schemaVersion,
    descriptorSha256: hashSnapshotInput(
      serializeRuntimeDependencySnapshot(snapshot),
      "descriptor",
    ),
    target: snapshot.target,
    sourceLockfileSha256: snapshot.sourceLockfileSha256,
    runtimeLockfileSha256: snapshot.runtimeLockfileSha256,
    runtimeWorkspaceConfigSha256: snapshot.runtimeWorkspaceConfigSha256,
    storeSnapshot: normalizeRuntimeDependencyStoreSnapshot(snapshot.storeSnapshot),
  });
}

function assertArtifactIdentityObject(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("Runtime dependency snapshot artifact identity must be an object");
  }
}

export function assertRuntimeDependencySnapshotArtifactIdentityEqual(identity, expected) {
  assertArtifactIdentityObject(identity);
  assertArtifactIdentityObject(expected);
  const mismatches = ARTIFACT_IDENTITY_FIELDS.filter(
    (field) => identity[field] !== expected[field],
  );
  for (const field of TARGET_FIELDS) {
    if (identity.target?.[field] !== expected.target?.[field]) {
      mismatches.push(`target.${field}`);
    }
  }
  for (const field of STORE_SNAPSHOT_FIELDS) {
    if (identity.storeSnapshot?.[field] !== expected.storeSnapshot?.[field]) {
      mismatches.push(`storeSnapshot.${field}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Runtime dependency snapshot artifact identity mismatch: ${mismatches.join(", ")}`);
  }
  return identity;
}

export function assertRuntimeDependencySnapshotArtifactIdentity(identity, snapshot) {
  return assertRuntimeDependencySnapshotArtifactIdentityEqual(
    identity,
    createRuntimeDependencySnapshotArtifactIdentity(snapshot),
  );
}
