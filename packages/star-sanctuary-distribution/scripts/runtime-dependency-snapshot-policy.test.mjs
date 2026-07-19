import { describe, expect, it } from "vitest";

import {
  assertRuntimeDependencySnapshotArtifactIdentity,
  assertRuntimeDependencySnapshotArtifactIdentityEqual,
  assertRuntimeDependencySnapshot,
  createRuntimeDependencySnapshotArtifactIdentity,
  createRuntimeDependencySnapshot,
  serializeRuntimeDependencySnapshot,
} from "./runtime-dependency-snapshot-policy.mjs";

const target = {
  mode: "slim",
  platform: "win32",
  arch: "x64",
  nodeAbi: "127",
};
const sourceLockfile = Buffer.from("source-lockfile-v1\n", "utf-8");
const runtimeLockfile = Buffer.from("runtime-lockfile-a\n", "utf-8");
const runtimeWorkspaceConfig = Buffer.from("packages:\n  - packages/*\n", "utf-8");
const storeSnapshot = {
  schemaVersion: "runtime-dependency-store-snapshot/v1",
  fileCount: 2,
  totalSize: 32,
  entriesSha256: "c".repeat(64),
};

function createSnapshot(input) {
  return createRuntimeDependencySnapshot({ storeSnapshot, ...input });
}

function assertSnapshot(snapshot, input) {
  return assertRuntimeDependencySnapshot(snapshot, { storeSnapshot, ...input });
}

describe("runtime dependency snapshot policy", () => {
  it("rejects a snapshot produced for another Node ABI target", () => {
    const snapshot = createSnapshot({
      target: { ...target, nodeAbi: "115" },
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
    });

    expect(() => assertSnapshot(snapshot, {
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
    })).toThrow(/snapshot target mismatch.*nodeAbi/i);
  });

  it("rejects source lockfile, runtime lockfile, or build policy replacement", () => {
    const snapshot = createSnapshot({
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
    });
    const sameLengthReplacement = Buffer.from("runtime-lockfile-b\n", "utf-8");

    expect(() => assertSnapshot(snapshot, {
      target,
      sourceLockfile: Buffer.from("source-lockfile-v2\n", "utf-8"),
      runtimeLockfile,
      runtimeWorkspaceConfig,
    })).toThrow(/sourceLockfileSha256/i);
    expect(() => assertSnapshot(snapshot, {
      target,
      sourceLockfile,
      runtimeLockfile: sameLengthReplacement,
      runtimeWorkspaceConfig,
    })).toThrow(/runtimeLockfileSha256/i);
    expect(() => assertSnapshot(snapshot, {
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig: Buffer.from("packages:\n  - apps/*\n", "utf-8"),
    })).toThrow(/runtimeWorkspaceConfigSha256/i);
    expect(() => assertSnapshot(snapshot, {
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
      storeSnapshot: {
        ...storeSnapshot,
        entriesSha256: "d".repeat(64),
      },
    })).toThrow(/storeSnapshot\.entriesSha256/i);
  });

  it("serializes a canonical descriptor accepted for the same target and lockfiles", () => {
    const snapshot = createSnapshot({
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
    });
    const serialized = serializeRuntimeDependencySnapshot(snapshot);
    const parsed = JSON.parse(serialized);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(parsed).toEqual(snapshot);
    expect(assertSnapshot(parsed, {
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
    })).toBe(parsed);
  });

  it("rejects artifact identity field or descriptor hash replacement", () => {
    const snapshot = createSnapshot({
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
    });
    const identity = createRuntimeDependencySnapshotArtifactIdentity(snapshot);

    expect(assertRuntimeDependencySnapshotArtifactIdentity(identity, snapshot)).toBe(identity);
    expect(() => assertRuntimeDependencySnapshotArtifactIdentity({
      ...identity,
      runtimeLockfileSha256: "a".repeat(64),
    }, snapshot)).toThrow(/runtimeLockfileSha256/i);
    expect(() => assertRuntimeDependencySnapshotArtifactIdentity({
      ...identity,
      descriptorSha256: "b".repeat(64),
    }, snapshot)).toThrow(/descriptorSha256/i);
    expect(() => assertRuntimeDependencySnapshotArtifactIdentity({
      ...identity,
      storeSnapshot: {
        ...identity.storeSnapshot,
        entriesSha256: "e".repeat(64),
      },
    }, snapshot)).toThrow(/storeSnapshot\.entriesSha256/i);
  });

  it("rejects outer and extracted artifact identity mismatch", () => {
    const snapshot = createSnapshot({
      target,
      sourceLockfile,
      runtimeLockfile,
      runtimeWorkspaceConfig,
    });
    const outerIdentity = createRuntimeDependencySnapshotArtifactIdentity(snapshot);
    const extractedIdentity = {
      ...outerIdentity,
      target: {
        ...outerIdentity.target,
        nodeAbi: "115",
      },
    };

    expect(() => assertRuntimeDependencySnapshotArtifactIdentityEqual(
      outerIdentity,
      extractedIdentity,
    )).toThrow(/target\.nodeAbi/i);
  });
});
