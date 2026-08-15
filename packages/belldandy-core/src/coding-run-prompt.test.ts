import { describe, expect, it } from "vitest";

import {
  CODING_RUN_PROMPT_MODE,
  buildCodingRunPromptOverride,
} from "./coding-run-prompt.js";

describe("buildCodingRunPromptOverride", () => {
  it("uses a bounded static prompt only for coding runs", () => {
    expect(buildCodingRunPromptOverride(undefined)).toBeUndefined();

    const override = buildCodingRunPromptOverride({
      cwd: "E:/workspace/project",
      toolAllow: ["file_read", "list_files"],
    });

    expect(override).toMatchObject({
      text: expect.stringContaining("# Bounded Coding Run"),
      metadata: {
        codingRunPromptMode: CODING_RUN_PROMPT_MODE,
      },
    });
    expect((override?.sections ?? []).map((section) => section.id)).toEqual([
      "coding-run-base",
      "coding-run-execution-policy",
    ]);
    expect(override?.text).toContain("Project-owned AGENTS.md rules");
    expect(override?.text).toContain("raw JSON only");
    expect(override?.text).not.toContain("SOUL.md");
    expect(override?.text).not.toContain("Methodology System");
    expect(override?.text.length).toBeLessThan(1_600);
  });

  it("adds the trusted success condition only for mutation-required runs", () => {
    const override = buildCodingRunPromptOverride({
      automationProfile: "bare",
      cwd: "E:/workspace/project",
      toolAllow: ["file_read", "apply_patch"],
      permissionMode: "acceptEdits",
      workspaceMutationRequirement: "required",
    });

    expect(override?.text).toContain("successful workspace mutation");
    expect(override?.text).toContain("must fail closed");
    expect(override?.sections?.map((section) => section.id)).toContain("coding-run-workspace-mutation");
  });
});
