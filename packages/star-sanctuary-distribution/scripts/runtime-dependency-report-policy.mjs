import { assertRuntimeNativeMatrix } from "./runtime-native-matrix-policy.mjs";
import { createRuntimeDependencyReportTarget } from "./runtime-dependency-target-policy.mjs";

export {
  RUNTIME_DEPENDENCY_REPORT_TARGET_SCHEMA_VERSION,
  createRuntimeDependencyReportTarget,
} from "./runtime-dependency-target-policy.mjs";

const TARGET_FIELDS = ["schemaVersion", "mode", "platform", "arch", "nodeAbi"];

export function assertRuntimeDependencyReport(report, expectedTargetInput) {
  const expectedTarget = createRuntimeDependencyReportTarget(expectedTargetInput);
  const actualTarget = report && typeof report === "object" && !Array.isArray(report)
    ? report.target
    : null;
  const mismatches = TARGET_FIELDS.filter((field) => actualTarget?.[field] !== expectedTarget[field]);
  if (report?.mode !== expectedTarget.mode && !mismatches.includes("mode")) {
    mismatches.push("mode");
  }
  if (mismatches.length > 0) {
    throw new Error(`Runtime dependency report target mismatch: ${mismatches.join(", ")}`);
  }
  assertRuntimeNativeMatrix(report.nativeMatrix, expectedTarget);

  const failures = [
    ["betterSqlite3.ok", report.betterSqlite3?.ok],
    ["sqliteVec.ok", report.sqliteVec?.ok],
    ["protobufjs.ok", report.protobufjs?.ok],
    ["launcher.openModule.ok", report.launcher?.openModule?.ok],
    ["browserToolchain.puppeteerCore.ok", report.browserToolchain?.puppeteerCore?.ok],
    ["browserToolchain.browserToolsModule.ok", report.browserToolchain?.browserToolsModule?.ok],
    ["browserToolchain.readability.ok", report.browserToolchain?.readability?.ok],
    ["browserToolchain.turndown.ok", report.browserToolchain?.turndown?.ok],
  ]
    .filter(([, value]) => value !== true)
    .map(([field]) => field);
  if (expectedTarget.mode === "full") {
    if (report.nodePty?.installed !== true) failures.push("nodePty.installed");
    if (report.nodePty?.backend !== "node-pty") failures.push("nodePty.backend");
    if (report.optionalPayloads?.fastembed?.present !== true) {
      failures.push("optionalPayloads.fastembed.present");
    }
    if (report.optionalPayloads?.fastembed?.load?.ok !== true) {
      failures.push("optionalPayloads.fastembed.load.ok");
    }
    if (report.optionalPayloads?.nodePty?.present !== true) {
      failures.push("optionalPayloads.nodePty.present");
    }
    if (report.optionalPayloads?.onnxruntimeNode?.present !== true) {
      failures.push("optionalPayloads.onnxruntimeNode.present");
    }
    if (report.optionalPayloads?.onnxruntimeNode?.load?.ok !== true) {
      failures.push("optionalPayloads.onnxruntimeNode.load.ok");
    }
  } else {
    if (report.nodePty?.installed !== false) failures.push("nodePty.installed");
    if (report.nodePty?.backend !== "child_process") failures.push("nodePty.backend");
    if (report.optionalPayloads?.fastembed?.present !== false) {
      failures.push("optionalPayloads.fastembed.present");
    }
    if (report.optionalPayloads?.nodePty?.present !== false) {
      failures.push("optionalPayloads.nodePty.present");
    }
    if (report.optionalPayloads?.onnxruntimeNode?.present !== false) {
      failures.push("optionalPayloads.onnxruntimeNode.present");
    }
  }
  if (failures.length > 0) {
    throw new Error(`Runtime dependency report failed checks: ${failures.join(", ")}`);
  }
  return report;
}
