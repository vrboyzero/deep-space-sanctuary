import { describe, expect, it } from "vitest";

import {
  buildWorkspaceMutationNavigationRequest,
  buildWorkspaceMutationVerificationRequest,
  hasExpandedSmallestChangeCorrectionHunks,
} from "./react-workspace-mutation.js";
import { isRegressiveCommandNameCorrection } from "./react-workspace-mutation-go-correction.js";

describe("formal workspace-mutation regressions", () => {
  it("keeps all eight trusted required paths in one pre-write navigation request", () => {
    const requiredPaths = [
      "cmd/root.go",
      "cmd/help.go",
      "cmd/completion.go",
      "cmd/docs.go",
      "internal/shell.go",
      "internal/template.go",
      "site/main.go",
      "site/reference.go",
    ];
    const request = buildWorkspaceMutationNavigationRequest({
      messages: [{ role: "user", content: "Migrate every frozen public caller." }],
      tools: [toolDefinition("file_read")],
      maxInputTokens: 2_048,
      missingRequiredChangedPaths: requiredPaths,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    });

    expect(request).toBeDefined();
    expect(request?.maxFileReadCalls).toBe(8);
    expect(request?.missingRequiredSourceEvidencePaths).toEqual(requiredPaths);
    expect(request?.messages[0]?.content).toContain("at most 8 file_read calls");
  });

  it("does not expand the three-path post-write verification boundary", () => {
    const request = buildWorkspaceMutationVerificationRequest({
      messages: [{ role: "user", content: "Verify the completed migration." }],
      tools: [toolDefinition("file_read")],
      maxInputTokens: 2_048,
      requiredChangedPaths: ["one.go", "two.go", "three.go", "four.go"],
    });

    expect(request).toBeUndefined();
  });

  it("recognizes the frozen Go whole-method rewrite under smallest-correction wording", () => {
    const initialPatch = [
      "*** Begin Patch",
      "*** Update File: command.go",
      "@@",
      " func (c *Command) Name() string {",
      " \tname := c.Use",
      "-\ti := strings.LastIndex(name, \" \")",
      "+\ti := strings.Index(name, \" \")",
      " \tif i >= 0 {",
      " \t\tname = name[:i]",
      " \t}",
      " \treturn name",
      " }",
      "*** End Patch",
    ].join("\n");
    const correctionPatch = [
      "*** Begin Patch",
      "*** Update File: command.go",
      "@@",
      " func (c *Command) Name() string {",
      "-\tname := c.Use",
      "-\ti := strings.Index(name, \" \")",
      "-\tif i >= 0 {",
      "-\t\tname = name[:i]",
      "-\t}",
      "+\tname, _, _ := strings.Cut(c.Use, \" \")",
      " \treturn name",
      " }",
      "*** End Patch",
    ].join("\n");

    const taskText = "Reproduce the frozen Go regression, make the smallest correction, and keep the repository's deterministic tests passing with GOPROXY disabled.";
    expect(hasExpandedSmallestChangeCorrectionHunks(
      toolCall(correctionPatch),
      [initialPatch],
      taskText,
    )).toBe(false);
    expect(isRegressiveCommandNameCorrection({
      toolCall: toolCall(correctionPatch),
      priorSuccessfulPatchInputs: [initialPatch],
      taskText,
      requiredChangedPaths: ["command.go"],
    })).toBe(true);
  });
});

function toolDefinition(name: string) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `${name} description`,
      parameters: { type: "object", properties: {} },
    },
  };
}

function toolCall(input: string) {
  return {
    function: {
      name: "apply_patch",
      arguments: JSON.stringify({ input }),
    },
  };
}
