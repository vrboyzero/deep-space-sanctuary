import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODING_AGENT_CANDIDATE_GLOBAL_RUNNER_INPUT_VERSION,
  parseCodingAgentCandidateGlobalReceiptCliArguments,
  runCodingAgentCandidateGlobalReceipt,
  runCodingAgentCandidateGlobalReceiptFromFile,
} from "./run-coding-agent-candidate-global-receipt.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("coding agent candidate-global receipt runner", () => {
  it("loads a versioned JSON input contract before invoking the runner seam", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-global-runner-input-"));
    tempRoots.push(root);
    const inputPath = path.join(root, "runner-input.json");
    const sensitiveValue = "runner-input-sensitive-value";
    const input = validRunnerInput({
      sensitiveValueEnvironmentVariables: ["CANDIDATE_GLOBAL_TEST_SENSITIVE_VALUE"],
    });
    await fs.writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf-8");

    const observed = {};
    const result = await runCodingAgentCandidateGlobalReceiptFromFile(inputPath, {
      environment: {
        CANDIDATE_GLOBAL_TEST_SENSITIVE_VALUE: sensitiveValue,
      },
      async collectGlobalEvidence(value) {
        observed.evidenceInput = value;
        return {
          sensitiveScan: {
            status: "completed",
            scope: "candidate_declared_roots",
            linkPolicy: "count_do_not_follow",
            contentPolicy: "exact_values_non_echoing",
            rootCount: 1,
            regularFileCount: 1,
            unreadableFileCount: 0,
            symlinkOrReparsePointCount: 0,
            findingCount: 0,
          },
          resourceSweeps: [
            resourceSweep("windows-native"),
            resourceSweep("wsl2-linux"),
          ],
        };
      },
      async writeReceipt(value) {
        observed.receiptInput = value;
        return { status: "written" };
      },
    });

    expect(result).toEqual({ status: "written" });
    expect(observed.evidenceInput).toMatchObject({
      sensitiveRoots: input.sensitiveRoots,
      sensitiveValues: [sensitiveValue],
    });
    expect(observed.receiptInput).toMatchObject({
      aggregateRoot: input.aggregateRoot,
      generatedAt: input.generatedAt,
    });
  });

  it("fails closed on input schema drift before invoking any adapter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-global-runner-input-"));
    tempRoots.push(root);
    const inputPath = path.join(root, "runner-input-invalid.json");
    await fs.writeFile(inputPath, `${JSON.stringify({
      ...validRunnerInput(),
      unexpected: true,
    })}\n`, "utf-8");
    let invoked = false;

    await expect(runCodingAgentCandidateGlobalReceiptFromFile(inputPath, {
      collectGlobalEvidence: async () => {
        invoked = true;
        throw new Error("must not invoke evidence adapter");
      },
    })).rejects.toThrow(/input.*schema/i);
    expect(invoked).toBe(false);
  });

  it("rejects an invalid generatedAt before resolving secrets or invoking an adapter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-global-runner-input-"));
    tempRoots.push(root);
    const inputPath = path.join(root, "runner-input-invalid-time.json");
    await fs.writeFile(inputPath, `${JSON.stringify(validRunnerInput({
      generatedAt: "not-a-timestamp",
    }))}\n`, "utf-8");
    let invoked = false;

    await expect(runCodingAgentCandidateGlobalReceiptFromFile(inputPath, {
      environment: {},
      collectGlobalEvidence: async () => {
        invoked = true;
        throw new Error("must not invoke evidence adapter");
      },
    })).rejects.toThrow(/input.*schema/i);
    expect(invoked).toBe(false);
  });

  it("fails closed on a missing sensitive environment variable without invoking an adapter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-global-runner-input-"));
    tempRoots.push(root);
    const inputPath = path.join(root, "runner-input-missing-environment.json");
    await fs.writeFile(inputPath, `${JSON.stringify(validRunnerInput({
      sensitiveValueEnvironmentVariables: [
        "CANDIDATE_GLOBAL_PRESENT_VALUE",
        "CANDIDATE_GLOBAL_MISSING_VALUE",
      ],
    }))}\n`, "utf-8");
    let invoked = false;

    let failure;
    try {
      await runCodingAgentCandidateGlobalReceiptFromFile(inputPath, {
        environment: {
          CANDIDATE_GLOBAL_PRESENT_VALUE: "must-not-be-recorded",
        },
        collectGlobalEvidence: async () => {
          invoked = true;
          throw new Error("must not invoke evidence adapter");
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/CANDIDATE_GLOBAL_MISSING_VALUE/);
    expect(failure.message).not.toContain("must-not-be-recorded");
    expect(invoked).toBe(false);
  });

  it("parses exactly one input file CLI argument", () => {
    const parsed = parseCodingAgentCandidateGlobalReceiptCliArguments([
      "--input",
      "candidate-global-runner-input.json",
    ]);
    expect(parsed).toEqual({
      inputPath: path.resolve("candidate-global-runner-input.json"),
    });
    expect(() => parseCodingAgentCandidateGlobalReceiptCliArguments([]))
      .toThrow(/--input/i);
    expect(() => parseCodingAgentCandidateGlobalReceiptCliArguments([
      "--input",
      "one.json",
      "--input",
      "two.json",
    ])).toThrow(/once|duplicate/i);
    expect(() => parseCodingAgentCandidateGlobalReceiptCliArguments(["--unknown", "x"]))
      .toThrow(/unknown/i);
  });

  it("does not write a receipt when either platform evidence collection fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-global-runner-"));
    tempRoots.push(root);
    const aggregateRoot = path.join(root, "aggregate");
    const sensitiveRoot = path.join(root, "sensitive-root");
    await fs.mkdir(aggregateRoot, { recursive: true });
    await fs.mkdir(sensitiveRoot, { recursive: true });
    await fs.writeFile(path.join(sensitiveRoot, "safe.txt"), "safe fixture\n", "utf-8");

    await expect(runCodingAgentCandidateGlobalReceipt({
      aggregateRoot,
      generatedAt: "2026-09-01T01:00:00.000Z",
      sensitiveRoots: [sensitiveRoot],
      sensitiveValues: ["candidate-global-runner-sensitive-value"],
      wslDistribution: "Ubuntu-22.04",
      resourceInventories: {
        "windows-native": emptyResourceInventory(),
        "wsl2-linux": emptyResourceInventory(),
      },
    }, {
      async probeOwnedResources({ platform, inventory }) {
        if (platform === "wsl2-linux") {
          throw new Error("WSL2 owned-resource probe unavailable for test.");
        }
        return Object.fromEntries(
          Object.entries(inventory).map(([key, values]) => [key, values.map(() => false)]),
        );
      },
    })).rejects.toThrow(/WSL2 owned-resource probe unavailable/i);

    await expect(fs.access(path.join(aggregateRoot, "candidate-global-receipt.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

function validRunnerInput(overrides = {}) {
  return {
    schemaVersion: CODING_AGENT_CANDIDATE_GLOBAL_RUNNER_INPUT_VERSION,
    aggregateRoot: path.join(os.tmpdir(), "candidate-global-aggregate"),
    generatedAt: "2026-09-01T01:00:00.000Z",
    sensitiveRoots: [path.join(os.tmpdir(), "candidate-global-sensitive")],
    sensitiveValueEnvironmentVariables: ["CANDIDATE_GLOBAL_SENSITIVE_VALUE"],
    resourceInventories: {
      "windows-native": emptyResourceInventory(),
      "wsl2-linux": emptyResourceInventory(),
    },
    wslDistribution: "Ubuntu-22.04",
    ...overrides,
  };
}

function resourceSweep(platform) {
  return {
    platform,
    status: "completed",
    scope: "candidate_owned_resources",
    remainingListenerCount: 0,
    remainingOwnedProcessCount: 0,
    remainingRuntimeMarkerCount: 0,
    remainingRuntimeEnvFileCount: 0,
    orphanResourceCount: 0,
  };
}

function emptyResourceInventory() {
  return {
    listeners: [],
    processIds: [],
    runtimeMarkers: [],
    runtimeEnvFiles: [],
  };
}
