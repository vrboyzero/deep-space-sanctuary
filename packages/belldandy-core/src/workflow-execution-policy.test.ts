import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveWorkflowExecutionPolicy } from "./workflow-execution-policy.js";

describe("WorkflowExecutionPolicy", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("默认拒绝 inline 和未批准 file source", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-workflow-policy-"));
    tempDirs.push(stateDir);

    const policy = resolveWorkflowExecutionPolicy({ stateDir, readEnv: () => undefined });

    expect(policy).toMatchObject({
      workflowRoot: path.join(stateDir, "workflows"),
      allowInline: false,
      allowLegacyFiles: false,
    });
    expect(policy.approvedFileHashes.size).toBe(0);
  });

  it("只接受相对路径和 sha256 身份均有效的批准 manifest", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-workflow-policy-"));
    const workflowsDir = path.join(stateDir, "workflows");
    tempDirs.push(stateDir);
    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.writeFile(path.join(workflowsDir, "approved-workflows.json"), JSON.stringify({
      version: 1,
      workflows: {
        "daily-report.mjs": {
          sha256: "a".repeat(64),
        },
      },
    }), "utf-8");

    const policy = resolveWorkflowExecutionPolicy({
      stateDir,
      readEnv: (name) => name === "BELLDANDY_WORKFLOW_INLINE_ENABLED" ? "true" : undefined,
    });

    expect(policy.allowInline).toBe(true);
    expect(policy.approvedFileHashes.get("daily-report.mjs")).toBe("a".repeat(64));
  });

  it("损坏批准 manifest fail-closed", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-workflow-policy-"));
    const workflowsDir = path.join(stateDir, "workflows");
    tempDirs.push(stateDir);
    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.writeFile(path.join(workflowsDir, "approved-workflows.json"), JSON.stringify({
      version: 1,
      workflows: { "../escape.mjs": { sha256: "short" } },
    }), "utf-8");

    expect(() => resolveWorkflowExecutionPolicy({ stateDir, readEnv: () => undefined }))
      .toThrow(/invalid workflow approval manifest/i);
  });
});
