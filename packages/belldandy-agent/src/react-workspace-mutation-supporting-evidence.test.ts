import { describe, expect, it } from "vitest";

import { applyPatchTool } from "../../belldandy-skills/src/builtin/apply-patch/index.js";
import {
  buildWorkspaceMutationObjectiveOutputRepairRequest,
  buildWorkspaceMutationObjectiveReviewRequest,
  type WorkspaceMutationSourceMessage,
} from "./react-workspace-mutation.js";

const assertion = "assert.deepEqual(pager.remaining([10, 20, 30, 40], 2), [30, 40]);";
function fixture(path = "test/pager.test.js", truncated = false) {
  return {
    maxInputTokens: 2048,
    tools: [{ type: "function" as const, function: applyPatchTool.definition }],
    requiredChangedPaths: ["src/pager.js"],
    structuredOutputRequired: true,
    structuredOutputSchema: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
    validationMessage: "Output is not valid JSON.",
    tokenEstimateContext: { model: "deepseek-v4-flash" },
    messages: [
      { role: "user", content: "Restore pager.remaining with the smallest change in src/pager.js. The regression is in test/pager.test.js. Return JSON with a summary." },
      { role: "assistant", tool_calls: [{ id: "test-read", function: { name: "file_read", arguments: JSON.stringify({ path }) } }] },
      { role: "tool", tool_call_id: "test-read", content: JSON.stringify({ path, truncated, content: assertion }) },
      { role: "assistant", tool_calls: [{ id: "source-read", function: { name: "file_read", arguments: '{"path":"src/pager.js"}' } }] },
      { role: "tool", tool_call_id: "source-read", content: JSON.stringify({ path: "src/pager.js", truncated: false,
        content: "pager.remaining = (values, offset) => values.slice(offset + 1);" }) },
    ] as WorkspaceMutationSourceMessage[],
  };
}

describe("post-write referenced source evidence", () => {
  for (const [phase, build] of [["review", buildWorkspaceMutationObjectiveReviewRequest],
    ["repair", buildWorkspaceMutationObjectiveOutputRepairRequest]] as const) {
    it(`retains an already-read task assertion together with current source in ${phase}`, () => {
      const request = build(fixture());
      expect(request).toBeDefined();
      expect(request!.estimatedInputTokens).toBeLessThanOrEqual(2048);
      expect(request!.messages[1].content).toContain(assertion);
      expect(request!.messages[1].content).toContain("values.slice(offset + 1)");
      expect(request!.messages[1].content).toContain("not test execution");
      expect(request!.tools).toEqual(fixture().tools);
      expect(request!.missingRequiredSourceEvidencePaths).toEqual([]);
    });

    it.each([["test/other.test.js", false], ["test/pager.test.js", true]])(
      `does not promote unreferenced or truncated read evidence in ${phase}: %s`, (path, truncated) => {
        const request = build(fixture(path, truncated));
        expect(request!.messages[1].content).not.toContain(assertion);
      },
    );

    it(`does not fall back to an older supporting read after a truncated newer read in ${phase}`, () => {
      const input = fixture();
      input.messages.splice(3, 0,
        { role: "assistant", tool_calls: [{ id: "newer-read", function: { name: "file_read", arguments: '{"path":"test/pager.test.js"}' } }] },
        { role: "tool", tool_call_id: "newer-read", content: JSON.stringify({ path: "test/pager.test.js", truncated: true, content: "newer" }) });
      expect(build(input)!.messages[1].content).not.toContain(assertion);
    });

    it(`requires the exact referenced path rather than a filename prefix in ${phase}`, () => {
      const input = fixture();
      input.messages[0].content = "Fix src/pager.js using test/pager.test.js.backup.";
      expect(build(input)!.messages[1].content).not.toContain(assertion);
    });

    it(`keeps the current source and total bound with optional evidence in ${phase}`, () => {
      for (const maxInputTokens of [1400, 1600, 1800, 2048]) {
        const request = build({ ...fixture(), maxInputTokens });
        if (!request) continue;
        expect(request.estimatedInputTokens).toBeLessThanOrEqual(maxInputTokens);
        expect(request.messages[1].content).toContain("values.slice(offset + 1)");
      }
    });
  }
});
