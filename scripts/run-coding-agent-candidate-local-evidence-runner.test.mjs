import { describe, expect, it } from "vitest";

import {
  parseCodingAgentCandidateLocalEvidenceArguments,
  runCodingAgentCandidateLocalEvidence,
} from "./run-coding-agent-candidate-local-evidence.mjs";

const OWNER_BY_STAGE = {
  collectCodeIntelEvidence: "candidateCodeIntelReceipt",
  collectCodingRunClientEvidence: "candidateCodingRunClientReceipt",
  collectVerificationEvidence: "candidateVerificationReceipt",
  collectSupervisorEvidence: "candidateSupervisorReceipt",
  collectCliTuiEvidence: "candidateCliTuiReceipt",
  collectGitDeliveryEvidence: "candidateGitDeliveryReceipt",
};

describe("coding agent candidate local evidence runner", () => {
  it("resumes after a failed stage without repeating completed owners", async () => {
    const reference = { aggregate: { harness: { commit: "a".repeat(40) } }, owners: {} };
    const wslWorkspaceRoot = "/var/tmp/star-sanctuary-linux";
    let referencePresent = false;
    let failCodingRun = true;
    const calls = [];
    const dependencies = {
      referenceExists: async () => referencePresent,
      loadState: async () => ({ reference, resolution: { status: "incomplete" } }),
      bootstrap: async () => {
        calls.push("bootstrap");
        referencePresent = true;
      },
    };
    for (const [dependency, owner] of Object.entries(OWNER_BY_STAGE)) {
      dependencies[dependency] = async () => {
        calls.push(dependency);
        if (dependency === "collectCodingRunClientEvidence" && failCodingRun) {
          throw new Error("deterministic audit interruption");
        }
        reference.owners[owner] = { artifact: { path: `${owner}.json` } };
      };
    }

    await expect(runCodingAgentCandidateLocalEvidence(
      {
        aggregateRoot: "candidate-root",
        generatedAt: "2026-09-02T10:00:00.000Z",
        wslWorkspaceRoot,
      },
      dependencies,
    )).rejects.toThrow(/audit interruption/i);
    expect(calls).toEqual([
      "bootstrap",
      "collectCodeIntelEvidence",
      "collectCodingRunClientEvidence",
    ]);

    failCodingRun = false;
    calls.length = 0;
    const result = await runCodingAgentCandidateLocalEvidence(
      {
        aggregateRoot: "candidate-root",
        generatedAt: "2026-09-02T10:01:00.000Z",
        wslWorkspaceRoot,
      },
      dependencies,
    );
    expect(calls).toEqual([
      "collectCodingRunClientEvidence",
      "collectVerificationEvidence",
      "collectSupervisorEvidence",
      "collectCliTuiEvidence",
      "collectGitDeliveryEvidence",
    ]);
    expect(result.stages).toEqual([
      { id: "bootstrap", status: "resumed" },
      { id: "code_intel", status: "resumed" },
      { id: "coding_run_client", status: "completed" },
      { id: "verification", status: "completed" },
      { id: "supervisor", status: "completed" },
      { id: "cli_tui", status: "completed" },
      { id: "git_delivery", status: "completed" },
    ]);
    expect(result.externalRequirements).toEqual([{
      id: "private_ci",
      owner: "candidateCodingRunClientCiReceipt",
      required: true,
      status: "external_required",
      executedByRunner: false,
    }]);
    expect(result.providerCalls).toBe(0);
  });

  it("requires a WSL workspace before writes but not after both native owners resume", async () => {
    let bootstrapCalled = false;
    await expect(runCodingAgentCandidateLocalEvidence(
      { aggregateRoot: "candidate-root" },
      {
        referenceExists: async () => false,
        bootstrap: async () => {
          bootstrapCalled = true;
        },
      },
    )).rejects.toThrow(/required before candidate bootstrap/i);
    expect(bootstrapCalled).toBe(false);

    const reference = {
      aggregate: { harness: { commit: "a".repeat(40) } },
      owners: Object.fromEntries(Object.values(OWNER_BY_STAGE).map((owner) => [
        owner,
        { artifact: { path: `${owner}.json` } },
      ])),
    };
    const result = await runCodingAgentCandidateLocalEvidence(
      { aggregateRoot: "candidate-root", generatedAt: "2026-09-02T10:02:00.000Z" },
      {
        referenceExists: async () => true,
        loadState: async () => ({ reference, resolution: { status: "incomplete" } }),
      },
    );
    expect(result.stages).toEqual([
      { id: "bootstrap", status: "resumed" },
      ...Object.keys(OWNER_BY_STAGE).map((dependency) => ({
        id: {
          collectCodeIntelEvidence: "code_intel",
          collectCodingRunClientEvidence: "coding_run_client",
          collectVerificationEvidence: "verification",
          collectSupervisorEvidence: "supervisor",
          collectCliTuiEvidence: "cli_tui",
          collectGitDeliveryEvidence: "git_delivery",
        }[dependency],
        status: "resumed",
      })),
    ]);
  });

  it("parses bounded native collection options and rejects short TUI windows", async () => {
    expect(parseCodingAgentCandidateLocalEvidenceArguments([
      "--aggregate-root", "aggregate",
      "--wsl-distribution", "Ubuntu-22.04",
      "--wsl-workspace-root", "/var/tmp/star-sanctuary-linux",
      "--startup-timeout-seconds", "30",
    ])).toMatchObject({
      wslDistribution: "Ubuntu-22.04",
      wslWorkspaceRoot: "/var/tmp/star-sanctuary-linux",
      startupTimeoutSeconds: 30,
    });
    expect(() => parseCodingAgentCandidateLocalEvidenceArguments([
      "--aggregate-root", "aggregate",
      "--startup-timeout-seconds", "29",
    ])).toThrow(/30 to 120/i);
    await expect(runCodingAgentCandidateLocalEvidence(
      { aggregateRoot: "candidate-root", startupTimeoutSeconds: 29 },
      {},
    )).rejects.toThrow(/30 to 120/i);
    expect(() => parseCodingAgentCandidateLocalEvidenceArguments([
      "--aggregate-root", "aggregate",
      "--wsl-workspace-root", "relative/workspace",
    ])).toThrow(/absolute WSL path/i);
    expect(() => parseCodingAgentCandidateLocalEvidenceArguments([
      "--aggregate-root", "aggregate",
      "--wsl-workspace-root", "/var/tmp/staging/../other",
    ])).toThrow(/absolute WSL path/i);
    await expect(runCodingAgentCandidateLocalEvidence(
      { aggregateRoot: "candidate-root", wslWorkspaceRoot: "relative/workspace" },
      {},
    )).rejects.toThrow(/absolute WSL path/i);
  });
});
