import { expect, test } from "vitest";

import {
  parseAndValidatePortableVersion,
  parseAndValidateRuntimeManifest,
} from "./runtime-manifest.js";

function createValidManifest(): Record<string, unknown> {
  return {
    productName: "Star Sanctuary",
    version: "0.5.4",
    distributionMode: "slim",
    platform: "win32",
    arch: "x64",
    builtAt: "2026-07-16T00:00:00.000Z",
    includeOptionalNative: false,
    runtimeDir: "runtime",
    summary: {
      fileCount: 2,
      totalSize: 7,
    },
    files: [
      {
        path: "packages/core/index.js",
        type: "file",
        size: 3,
        sha256: "a".repeat(64),
      },
      {
        path: "packages/core/link",
        type: "symlink",
        target: "../shared/index.js",
      },
      {
        path: "packages/shared/index.js",
        type: "file",
        size: 4,
        sha256: "b".repeat(64),
      },
    ],
  };
}

function createValidVersion(): Record<string, unknown> {
  return {
    productName: "Star Sanctuary",
    version: "0.5.4",
    distributionMode: "slim",
    platform: "win32",
    arch: "x64",
    builtAt: "2026-07-16T00:00:00.000Z",
    includeOptionalNative: false,
    runtimeDir: "runtime",
    entryScript: "runtime/packages/star-sanctuary-distribution/dist/portable-entry.js",
    runtimeSummary: {
      fileCount: 2,
      totalSize: 7,
    },
    files: {
      runtimeManifest: {
        path: "runtime-manifest.json",
        size: 1024,
        sha256: "c".repeat(64),
      },
    },
  };
}

test("accepts a bounded portable runtime manifest and version descriptor", () => {
  expect(parseAndValidateRuntimeManifest(createValidManifest())).toMatchObject({
    runtimeDir: "runtime",
    summary: { fileCount: 2, totalSize: 7 },
  });
  expect(parseAndValidatePortableVersion(createValidVersion())).toMatchObject({
    runtimeDir: "runtime",
    entryScript: "runtime/packages/star-sanctuary-distribution/dist/portable-entry.js",
  });
});

test("rejects unsafe runtime entry paths before extraction", () => {
  for (const unsafePath of ["../outside.js", "..\\outside.js", "/outside.js", "C:\\outside.js", "\\\\server\\share\\outside.js", `file\u0000name`]) {
    const manifest = createValidManifest();
    (manifest.files as Array<Record<string, unknown>>)[0]!.path = unsafePath;

    expect(() => parseAndValidateRuntimeManifest(manifest)).toThrow(/unsafe runtime relative path/i);
  }
});

test("rejects duplicate, parent-child, symlink escape, and summary drift manifest entries", () => {
  const duplicate = createValidManifest();
  (duplicate.files as Array<Record<string, unknown>>).push({
    path: "packages/core/index.js",
    type: "file",
    size: 1,
    sha256: "d".repeat(64),
  });
  expect(() => parseAndValidateRuntimeManifest(duplicate)).toThrow(/duplicate runtime manifest path/i);

  const parentChild = createValidManifest();
  (parentChild.files as Array<Record<string, unknown>>).push({
    path: "packages/core",
    type: "file",
    size: 1,
    sha256: "d".repeat(64),
  });
  (parentChild.summary as Record<string, unknown>).fileCount = 3;
  (parentChild.summary as Record<string, unknown>).totalSize = 8;
  expect(() => parseAndValidateRuntimeManifest(parentChild)).toThrow(/parent-child conflict/i);

  const escapingLink = createValidManifest();
  ((escapingLink.files as Array<Record<string, unknown>>)[1]!).target = "../../../outside.js";
  expect(() => parseAndValidateRuntimeManifest(escapingLink)).toThrow(/symlink target escapes runtime root/i);

  const summaryDrift = createValidManifest();
  (summaryDrift.summary as Record<string, unknown>).totalSize = 8;
  expect(() => parseAndValidateRuntimeManifest(summaryDrift)).toThrow(/runtime manifest summary totalSize/i);
});

test("rejects invalid hash formats and unsafe portable version paths", () => {
  const invalidHash = createValidManifest();
  (invalidHash.files as Array<Record<string, unknown>>)[0]!.sha256 = "not-a-sha";
  expect(() => parseAndValidateRuntimeManifest(invalidHash)).toThrow(/sha256/i);

  for (const unsafeValue of ["../runtime", "runtime\\entry.js", "C:\\runtime", "\\\\server\\share\\runtime"]) {
    const version = createValidVersion();
    version.runtimeDir = unsafeValue;
    expect(() => parseAndValidatePortableVersion(version)).toThrow(/unsafe runtime relative path/i);
  }
});
