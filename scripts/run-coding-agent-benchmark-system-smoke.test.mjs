import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseCodingAgentBenchmarkSystemSmokeCliArguments,
  runCodingAgentBenchmarkSystemSmoke,
} from "./run-coding-agent-benchmark-system-smoke.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("coding agent benchmark system smoke", () => {
  it("runs the three non-browser native harnesses and removes its temporary fixtures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-system-smoke-test-"));
    tempRoots.push(root);
    const temporaryRoot = path.join(root, "temporary");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(temporaryRoot, { recursive: true });

    const artifact = await runCodingAgentBenchmarkSystemSmoke({
      platform: process.platform === "win32" ? "windows-native" : "wsl2-linux",
      sourceRoot: path.resolve("."),
      outputRoot,
      temporaryRoot,
      taskIds: [
        "system.parallel-read-isolation",
        "system.parallel-write-fan-in",
        "system.restart-delivery-reconciliation",
      ],
    });

    expect(artifact).toMatchObject({
      schemaVersion: "coding-agent-benchmark-system-smoke/v1",
      status: "passed",
      capabilities: {
        parallelReadIsolation: true,
        parallelWriteFanIn: true,
        restartDeliveryReconciliation: true,
      },
      results: [
        { taskId: "system.parallel-read-isolation", status: "passed" },
        { taskId: "system.parallel-write-fan-in", status: "passed" },
        { taskId: "system.restart-delivery-reconciliation", status: "passed" },
      ],
    });
    for (const result of artifact.results) {
      const evidence = JSON.parse(await fs.readFile(
        path.join(outputRoot, result.taskId, "system-evidence.json"),
        "utf-8",
      ));
      expect(evidence).toMatchObject({ taskId: result.taskId, status: "passed", orphanResourceCount: 0 });
    }
    await expect(fs.readdir(temporaryRoot)).resolves.toEqual([]);
  }, 30_000);

  it("does not overwrite an existing output root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-system-smoke-output-test-"));
    tempRoots.push(root);
    const temporaryRoot = path.join(root, "temporary");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(temporaryRoot);
    await fs.mkdir(outputRoot);
    await fs.writeFile(path.join(outputRoot, "sentinel.txt"), "keep\n", "utf-8");

    await expect(runCodingAgentBenchmarkSystemSmoke({
      platform: process.platform === "win32" ? "windows-native" : "wsl2-linux",
      sourceRoot: path.resolve("."),
      outputRoot,
      temporaryRoot,
      taskIds: ["system.parallel-read-isolation"],
    })).rejects.toThrow("outputRoot must not already exist");
    await expect(fs.readFile(path.join(outputRoot, "sentinel.txt"), "utf-8")).resolves.toBe("keep\n");
    await expect(fs.readdir(temporaryRoot)).resolves.toEqual([]);
  });

  it("records unavailable capabilities without creating a fixture", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-system-smoke-capability-test-"));
    tempRoots.push(root);
    const temporaryRoot = path.join(root, "temporary");
    const outputRoot = path.join(root, "output");
    const browserExecutablePath = path.join(root, "browser", "chrome");
    await fs.mkdir(temporaryRoot);
    let harnessOptions;

    const artifact = await runCodingAgentBenchmarkSystemSmoke({
      platform: process.platform === "win32" ? "windows-native" : "wsl2-linux",
      sourceRoot: path.resolve("."),
      outputRoot,
      temporaryRoot,
      browserExecutablePath,
      taskIds: ["system.browser-behavior"],
    }, {
      createSystemHarness: async (options) => {
        harnessOptions = options;
        return {
          capabilities: {
            browserBehavior: false,
            parallelReadIsolation: true,
            parallelWriteFanIn: true,
            restartDeliveryReconciliation: true,
          },
          execute: async () => {
            throw new Error("unavailable harness must not execute");
          },
        };
      },
    });

    expect(harnessOptions).toEqual({ sourceRoot: path.resolve("."), browserExecutablePath });
    expect(artifact).toMatchObject({
      status: "unavailable",
      results: [{ taskId: "system.browser-behavior", status: "unavailable", evidenceSha256: null }],
    });
    await expect(fs.readdir(temporaryRoot)).resolves.toEqual([]);
    await expect(fs.readdir(path.join(outputRoot, "system.browser-behavior")))
      .resolves.toEqual(["preflight.json"]);
  });

  it("parses an explicit browser executable path", () => {
    const browserExecutablePath = path.resolve("fixtures", "browser", "chrome");
    expect(parseCodingAgentBenchmarkSystemSmokeCliArguments([
      "--output-root",
      path.resolve("artifacts", "system-smoke"),
      "--browser-executable-path",
      browserExecutablePath,
    ])).toMatchObject({ browserExecutablePath });
  });

  it("removes a generated fixture when harness execution fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-system-smoke-failure-test-"));
    tempRoots.push(root);
    const temporaryRoot = path.join(root, "temporary");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(temporaryRoot);

    const artifact = await runCodingAgentBenchmarkSystemSmoke({
      platform: process.platform === "win32" ? "windows-native" : "wsl2-linux",
      sourceRoot: path.resolve("."),
      outputRoot,
      temporaryRoot,
      taskIds: ["system.parallel-read-isolation"],
    }, {
      createSystemHarness: async () => ({
        capabilities: {
          browserBehavior: false,
          parallelReadIsolation: true,
          parallelWriteFanIn: true,
          restartDeliveryReconciliation: true,
        },
        execute: async () => {
          throw new Error("injected smoke failure");
        },
      }),
    });

    expect(artifact).toMatchObject({
      status: "failed",
      results: [{
        taskId: "system.parallel-read-isolation",
        status: "failed",
        evidenceSha256: null,
      }],
    });
    expect(artifact.results[0].diagnostics).toContain(
      "System smoke execution failed: injected smoke failure.",
    );
    await expect(fs.readdir(temporaryRoot)).resolves.toEqual([]);
  });
});
