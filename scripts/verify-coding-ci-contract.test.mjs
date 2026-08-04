import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODING_CI_AUTOMATION_PROFILE,
  CODING_CI_CONTRACT_VERSION,
  CODING_CI_LIMITS,
} from "./run-coding-agent-ci.mjs";
import { collectCodingCiContractFailures } from "./verify-coding-ci-contract.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");

describe("coding agent CI release contract", () => {
  it("keeps examples, schemas, versions, and public exit codes aligned", async () => {
    await expect(collectCodingCiContractFailures({ workspaceRoot })).resolves.toEqual([]);
  });

  it("keeps the GitHub Actions example read-only at the repository boundary", () => {
    const workflow = fs.readFileSync(
      path.join(workspaceRoot, "examples", "ci", "github-actions", "coding-agent-review.yml"),
      "utf-8",
    );

    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toMatch(/\b(?:contents|packages|actions|attestations|id-token): write\b/);
    expect(workflow).not.toMatch(/\bgit\s+(?:push|merge)\b/);

    const actionRefs = Array.from(workflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm), (match) => match[1]);
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const actionRef of actionRefs) {
      expect(actionRef).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
  });

  it("publishes the fixed budget and artifact version in the compatibility matrix", () => {
    const matrix = JSON.parse(fs.readFileSync(
      path.join(workspaceRoot, "examples", "ci", "compatibility.json"),
      "utf-8",
    ));

    expect(matrix.artifactSchemaVersion).toBe(CODING_CI_CONTRACT_VERSION);
    expect(matrix.capabilitySchemaVersion).toBe("coding-run-capabilities/v1");
    expect(matrix.automationProfile).toBe(CODING_CI_AUTOMATION_PROFILE);
    expect(matrix.limits).toEqual(CODING_CI_LIMITS);
    expect(matrix.supportedOperatingSystems).toEqual(["linux", "windows"]);
  });
});
