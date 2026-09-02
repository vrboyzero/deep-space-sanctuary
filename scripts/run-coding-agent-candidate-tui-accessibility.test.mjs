import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  readEvidenceReference,
  withSafetyEvidenceFixture,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";
import {
  collectIsolatedTuiAccessibilityObservation,
  parseCodingAgentCandidateTuiAccessibilityArguments,
  runCodingAgentCandidateTuiAccessibility,
} from "./run-coding-agent-candidate-tui-accessibility.mjs";
import { parseTuiAccessibilityNativeWorkerArguments } from "./run-tui-accessibility-native-worker.mjs";

function completeObservation(platform = "windows-native") {
  return {
    platform,
    environment: platform === "windows-native"
      ? {
        platform: "win32",
        arch: "x64",
        release: "fixture",
        nodeVersion: "v22.0.0",
        terminalBackend: "conpty",
        wsl: false,
      }
      : {
        platform: "linux",
        arch: "x64",
        release: "fixture",
        nodeVersion: "v22.0.0",
        terminalBackend: "unix-pty",
        wsl: true,
        distribution: "Ubuntu-fixture",
      },
    sample: {
      sequence: 1,
      capturedBytes: 4096,
      accessibility: {
        keyboardNavigation: true,
        focusVisible: true,
        labelsPresent: true,
      },
      lifecycle: {
        firstFrame: true,
        narrowFallback: true,
        wideLayoutRestored: true,
        mouseTabNavigation: true,
        inputReplayRendered: true,
        ctrlCSent: true,
        inputModesRestoredBeforeScreen: true,
        stateDirRemoved: true,
        exitCode: 0,
        timedOut: false,
        residualProcessCount: 0,
      },
    },
  };
}

describe("candidate TUI accessibility artifact producer", () => {
  it("parses one explicit current-candidate platform", () => {
    expect(parseCodingAgentCandidateTuiAccessibilityArguments([
      "--aggregate-root", "artifacts/candidate",
      "--platform", "wsl2-linux",
      "--startup-timeout-seconds", "45",
    ])).toMatchObject({
      platform: "wsl2-linux",
      startupTimeoutSeconds: 45,
    });
    expect(() => parseCodingAgentCandidateTuiAccessibilityArguments([
      "--aggregate-root", "artifacts/candidate",
    ])).toThrow(/--platform is required/i);
    expect(() => parseCodingAgentCandidateTuiAccessibilityArguments([
      "--aggregate-root", "artifacts/candidate",
      "--platform", "wsl2-linux",
      "--startup-timeout-seconds", "10",
    ])).toThrow(/between 30 and 120/i);
    expect(parseTuiAccessibilityNativeWorkerArguments([
      "--platform", "windows-native",
      "--startup-timeout-seconds", "30",
      "--state-dir", "artifacts/native-state",
    ])).toMatchObject({ platform: "windows-native", startupTimeoutSeconds: 30 });
  });

  it("writes a complete artifact from a real-collector-shaped observation", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      const aggregate = await readEvidenceReference(aggregateRoot);
      const result = await runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform: "windows-native",
        generatedAt: "2026-09-02T16:00:00.000Z",
      }, {
        resolveRepositoryIdentity: async () => aggregate.aggregate.harness,
        collectObservation: async () => completeObservation(),
      });
      expect(result.artifact).toMatchObject({
        schemaVersion: "tui-accessibility-cross-platform/v1",
        platform: "windows-native",
        status: "complete",
        gate: { passed: true, failures: [] },
      });
      expect(result.artifact.sourceIdentity.files.map(({ path }) => path)).toContain(
        "packages/belldandy-core/src/tui/app.tsx",
      );
      expect(result.artifact.sourceIdentity.files.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          "packages/belldandy-core/src/tui/index.tsx",
          "packages/belldandy-core/src/tui/runtime.ts",
        ]),
      );
      await expect(fs.readFile(result.outputPath, "utf8")).resolves.toContain(
        '"status": "complete"',
      );
    });
  });

  it("rejects a sub-baseline timeout before collecting candidate evidence", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      const aggregate = await readEvidenceReference(aggregateRoot);
      let collected = false;
      await expect(runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform: "wsl2-linux",
        startupTimeoutSeconds: 10,
      }, {
        resolveRepositoryIdentity: async () => aggregate.aggregate.harness,
        collectObservation: async () => {
          collected = true;
          return completeObservation("wsl2-linux");
        },
      })).rejects.toThrow(/between 30 and 120/i);
      expect(collected).toBe(false);
    });
  });

  it("preserves a trustworthy keyboard focus failure as failed evidence", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      const aggregate = await readEvidenceReference(aggregateRoot);
      const observation = completeObservation("wsl2-linux");
      observation.sample.accessibility.focusVisible = false;
      const result = await runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform: "wsl2-linux",
      }, {
        resolveRepositoryIdentity: async () => aggregate.aggregate.harness,
        collectObservation: async () => observation,
      });
      expect(result.artifact.status).toBe("failed");
      expect(result.artifact.gate).toEqual({
        passed: false,
        failures: ["accessibility.focusVisible did not pass"],
      });
    });
  });

  it("preserves a zero-output startup timeout as failed evidence", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      const aggregate = await readEvidenceReference(aggregateRoot);
      const observation = completeObservation("wsl2-linux");
      observation.sample.capturedBytes = 0;
      observation.sample.accessibility = {
        keyboardNavigation: false,
        focusVisible: false,
        labelsPresent: false,
      };
      observation.sample.lifecycle.firstFrame = false;
      observation.sample.lifecycle.timedOut = true;
      observation.sample.lifecycle.exitCode = -15;
      const result = await runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform: "wsl2-linux",
      }, {
        resolveRepositoryIdentity: async () => aggregate.aggregate.harness,
        collectObservation: async () => observation,
      });
      expect(result.artifact).toMatchObject({
        status: "failed",
        observation: { capturedBytes: 0 },
        gate: { passed: false },
      });
      expect(result.artifact.gate.failures).toContain("lifecycle.timedOut was true");
    });
  });

  it("rejects repository identity drift before starting the PTY collector", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      let collected = false;
      await expect(runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform: "windows-native",
      }, {
        resolveRepositoryIdentity: async () => ({
          commit: "9".repeat(40),
          workspaceDirty: false,
          lockfileSha256: "9".repeat(64),
          worktreeContentSha256: "9".repeat(64),
        }),
        collectObservation: async () => {
          collected = true;
          return completeObservation();
        },
      })).rejects.toThrow(/identity drifted/i);
      expect(collected).toBe(false);
    });
  });

  it("does not overwrite an existing platform artifact", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      const aggregate = await readEvidenceReference(aggregateRoot);
      const dependencies = {
        resolveRepositoryIdentity: async () => aggregate.aggregate.harness,
        collectObservation: async () => completeObservation(),
      };
      await runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform: "windows-native",
      }, dependencies);
      await expect(runCodingAgentCandidateTuiAccessibility({
        aggregateRoot,
        platform: "windows-native",
      }, dependencies)).rejects.toThrow(/already exists/i);
    });
  });
});
