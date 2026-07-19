import { createRuntimeDependencyReportTarget } from "./runtime-dependency-target-policy.mjs";

export const RUNTIME_NATIVE_MATRIX_SCHEMA_VERSION = "runtime-native-matrix/v1";

const TARGET_FIELDS = ["schemaVersion", "mode", "platform", "arch", "nodeAbi"];
const ENTRY_FIELDS = [
  "backend",
  "packageName",
  "expectedState",
  "loadExpectation",
  "fallbackBackend",
];

function createMatrixEntry(entry) {
  return Object.freeze(entry);
}

export function createRuntimeNativeMatrix(targetInput) {
  const target = createRuntimeDependencyReportTarget(targetInput);
  const full = target.mode === "full";
  const entries = [
    createMatrixEntry({
      backend: "better-sqlite3",
      packageName: "better-sqlite3",
      expectedState: "required",
      loadExpectation: "required",
      fallbackBackend: null,
    }),
    createMatrixEntry({
      backend: "sqlite-vec",
      packageName: "sqlite-vec",
      expectedState: "required",
      loadExpectation: "required",
      fallbackBackend: null,
    }),
    createMatrixEntry({
      backend: "pty",
      packageName: "node-pty",
      expectedState: full ? "required" : "fallback",
      loadExpectation: full ? "required" : "forbidden",
      fallbackBackend: full ? null : "child_process",
    }),
    createMatrixEntry({
      backend: "embedding-api",
      packageName: "fastembed",
      expectedState: full ? "required" : "absent",
      loadExpectation: full ? "required" : "forbidden",
      fallbackBackend: null,
    }),
    createMatrixEntry({
      backend: "embedding-runtime",
      packageName: "onnxruntime-node",
      expectedState: full ? "required" : "absent",
      loadExpectation: full ? "required" : "forbidden",
      fallbackBackend: null,
    }),
  ];
  return Object.freeze({
    schemaVersion: RUNTIME_NATIVE_MATRIX_SCHEMA_VERSION,
    target,
    entries: Object.freeze(entries),
  });
}

export function assertRuntimeNativeMatrix(matrix, targetInput) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    throw new Error("Runtime native matrix must be an object");
  }
  const expected = createRuntimeNativeMatrix(targetInput);
  const mismatches = [];
  if (matrix.schemaVersion !== expected.schemaVersion) {
    mismatches.push("schemaVersion");
  }
  for (const field of TARGET_FIELDS) {
    if (matrix.target?.[field] !== expected.target[field]) {
      mismatches.push(`target.${field}`);
    }
  }
  if (!Array.isArray(matrix.entries) || matrix.entries.length !== expected.entries.length) {
    mismatches.push("entries.length");
  }
  for (const [index, expectedEntry] of expected.entries.entries()) {
    const actualEntry = matrix.entries?.[index];
    for (const field of ENTRY_FIELDS) {
      if (actualEntry?.[field] !== expectedEntry[field]) {
        mismatches.push(`${expectedEntry.packageName}.${field}`);
      }
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Runtime native matrix mismatch: ${mismatches.join(", ")}`);
  }
  return matrix;
}
