import { describe, expect, it } from "vitest";

import {
  assertRuntimeDependencyReport,
  createRuntimeDependencyReportTarget,
} from "./runtime-dependency-report-policy.mjs";
import { createRuntimeNativeMatrix } from "./runtime-native-matrix-policy.mjs";

function createPassingReport(target) {
  return {
    productName: "Star Sanctuary",
    mode: target.mode,
    target,
    nativeMatrix: createRuntimeNativeMatrix(target),
    betterSqlite3: { ok: true },
    sqliteVec: { ok: true },
    nodePty: { installed: target.mode === "full", backend: target.mode === "full" ? "node-pty" : "child_process" },
    optionalPayloads: {
      fastembed: {
        present: target.mode === "full",
        load: { ok: target.mode === "full" ? true : null },
      },
      nodePty: { present: target.mode === "full" },
      onnxruntimeNode: {
        present: target.mode === "full",
        load: { ok: target.mode === "full" ? true : null },
      },
    },
    protobufjs: { ok: true },
    launcher: { openModule: { ok: true } },
    browserToolchain: {
      puppeteerCore: { ok: true },
      browserToolsModule: { ok: true },
      readability: { ok: true },
      turndown: { ok: true },
    },
  };
}

describe("runtime dependency report policy", () => {
  it("rejects a passing backend report from another Node ABI target", () => {
    const expectedTarget = createRuntimeDependencyReportTarget({
      mode: "full",
      platform: "win32",
      arch: "x64",
      nodeAbi: "127",
    });
    const report = createPassingReport({
      ...expectedTarget,
      nodeAbi: "115",
    });

    expect(() => assertRuntimeDependencyReport(report, expectedTarget)).toThrow(
      /runtime dependency report target mismatch.*nodeAbi/i,
    );
  });

  it("requires node-pty only for a full dependency report", () => {
    const slimTarget = createRuntimeDependencyReportTarget({
      mode: "slim",
      platform: "win32",
      arch: "x64",
      nodeAbi: "127",
    });
    const fullTarget = createRuntimeDependencyReportTarget({
      ...slimTarget,
      mode: "full",
    });
    const slimReport = createPassingReport(slimTarget);
    const fullReport = {
      ...createPassingReport(fullTarget),
      nodePty: { installed: false, backend: "child_process" },
    };

    expect(assertRuntimeDependencyReport(slimReport, slimTarget)).toBe(slimReport);
    expect(() => assertRuntimeDependencyReport(fullReport, fullTarget)).toThrow(
      /nodePty\.installed.*nodePty\.backend/i,
    );
  });

  it("rejects a slim report contaminated by optional native payloads", () => {
    const target = createRuntimeDependencyReportTarget({
      mode: "slim",
      platform: "win32",
      arch: "x64",
      nodeAbi: "127",
    });
    const report = createPassingReport(target);
    report.nodePty = { installed: true, backend: "node-pty" };
    report.optionalPayloads.fastembed.present = true;
    report.optionalPayloads.nodePty.present = true;
    report.optionalPayloads.onnxruntimeNode.present = true;

    expect(() => assertRuntimeDependencyReport(report, target)).toThrow(
      /nodePty\.installed.*nodePty\.backend.*optionalPayloads\.fastembed\.present.*optionalPayloads\.nodePty\.present.*optionalPayloads\.onnxruntimeNode\.present/i,
    );
  });

  it("rejects a full report missing optional native payloads", () => {
    const target = createRuntimeDependencyReportTarget({
      mode: "full",
      platform: "win32",
      arch: "x64",
      nodeAbi: "127",
    });
    const report = createPassingReport(target);
    report.optionalPayloads.fastembed.present = false;
    report.optionalPayloads.nodePty.present = false;
    report.optionalPayloads.onnxruntimeNode.present = false;

    expect(() => assertRuntimeDependencyReport(report, target)).toThrow(
      /optionalPayloads\.fastembed\.present.*optionalPayloads\.nodePty\.present.*optionalPayloads\.onnxruntimeNode\.present/i,
    );
  });

  it("rejects full optional modules that resolve but fail to load", () => {
    const target = createRuntimeDependencyReportTarget({
      mode: "full",
      platform: "win32",
      arch: "x64",
      nodeAbi: "127",
    });
    const report = createPassingReport(target);
    report.optionalPayloads.fastembed.load = { ok: false, error: "fastembed load failed" };
    report.optionalPayloads.onnxruntimeNode.load = { ok: false, error: "ONNX binding failed" };

    expect(() => assertRuntimeDependencyReport(report, target)).toThrow(
      /optionalPayloads\.fastembed\.load\.ok.*optionalPayloads\.onnxruntimeNode\.load\.ok/i,
    );
  });

  it("rejects a target-bound native matrix backend expectation drift", () => {
    const target = createRuntimeDependencyReportTarget({
      mode: "full",
      platform: "win32",
      arch: "x64",
      nodeAbi: "127",
    });
    const report = createPassingReport(target);
    report.nativeMatrix = {
      ...report.nativeMatrix,
      entries: report.nativeMatrix.entries.map((entry) => (
        entry.packageName === "onnxruntime-node"
          ? { ...entry, expectedState: "absent" }
          : entry
      )),
    };

    expect(() => assertRuntimeDependencyReport(report, target)).toThrow(
      /runtime native matrix.*onnxruntime-node.*expectedState/i,
    );
  });

  it("reports every failed common runtime dependency check", () => {
    const target = createRuntimeDependencyReportTarget({
      mode: "slim",
      platform: "win32",
      arch: "x64",
      nodeAbi: "127",
    });
    const report = createPassingReport(target);
    report.betterSqlite3.ok = false;
    report.sqliteVec.ok = false;
    report.protobufjs.ok = false;
    report.launcher.openModule.ok = false;
    report.browserToolchain.puppeteerCore.ok = false;
    report.browserToolchain.browserToolsModule.ok = false;
    report.browserToolchain.readability.ok = false;
    report.browserToolchain.turndown.ok = false;

    expect(() => assertRuntimeDependencyReport(report, target)).toThrow(
      /betterSqlite3\.ok.*sqliteVec\.ok.*protobufjs\.ok.*launcher\.openModule\.ok.*browserToolchain\.puppeteerCore\.ok.*browserToolchain\.browserToolsModule\.ok.*browserToolchain\.readability\.ok.*browserToolchain\.turndown\.ok/i,
    );
  });
});
