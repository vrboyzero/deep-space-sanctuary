import { describe, expect, it } from "vitest";

import { applyPatchTool } from "../../belldandy-skills/src/builtin/apply-patch/index.js";
import { compactWorkspaceMutationReadMetadata, fitWorkspaceMutationSourceContexts } from "./react-workspace-mutation-evidence-budget.js";
import {
  buildWorkspaceMutationObjectiveOutputRepairRequest,
  buildWorkspaceMutationObjectiveReviewRequest,
  type WorkspaceMutationSourceMessage,
} from "./react-workspace-mutation.js";

const requiredChangedPaths = ["transport/src/common/connection.ts", "transport/src/common/api.ts", "client/src/common/protocol.ts"];
const targets = [
  ['export type ResultCode = "ready" | "done";', 'export namespace ResultCode { export const Ready = "ready"; }'],
  ["import { ResultCode, ConnectionOptions } from './connection';", "export { ResultCode, ConnectionOptions };"],
  ["import { ResultCode } from 'transport';", "export interface ClientOptions { result?: ResultCode; }"],
];

function fixture() {
  const sources = targets.map((fileTargets) => [
    ...Array.from({ length: 60 }, (_, index) => `// unrelated header ${index}: ${"padding ".repeat(12)}`),
    fileTargets[0],
    ...Array.from({ length: 30 }, (_, index) => `// unrelated middle ${index}: ${"padding ".repeat(12)}`),
    fileTargets[1],
    ...Array.from({ length: 60 }, (_, index) => `// unrelated footer ${index}: ${"padding ".repeat(12)}`),
  ].join("\r\n"));
  const messages: WorkspaceMutationSourceMessage[] = [{ role: "user", content: [
    "Remove the deprecated LegacyResult aliases, update both public exports and migrate ClientOptions to ResultCode.",
    `Change exactly ${requiredChangedPaths.join(", ")}. Preserve tests and dependency metadata.`,
    "Return one JSON object with a non-empty summary.",
  ].join(" ") }];
  for (const [index, sourcePath] of requiredChangedPaths.entries()) {
    const size = Buffer.byteLength(sources[index]);
    messages.push(
      { role: "assistant", tool_calls: [{ id: `read-${index}`, function: { name: "file_read", arguments: JSON.stringify({ path: sourcePath }) } }] },
      { role: "tool", tool_call_id: `read-${index}`, content: JSON.stringify({ path: sourcePath,
        size, bytesRead: size, truncated: false, range: { offset: 0, endOffset: size }, encoding: "utf-8",
        revision: String(index + 1).repeat(64), content: sources[index] }) },
    );
  }
  return {
    messages,
    tools: [{ type: "function" as const, function: applyPatchTool.definition }],
    maxInputTokens: 2048,
    requiredChangedPaths,
    structuredOutputRequired: true,
    structuredOutputSchema: { type: "object", additionalProperties: false, required: ["summary"],
      properties: { summary: { type: "string", minLength: 1, maxLength: 1000 } } },
    validationMessage: "Output is not valid JSON.",
    tokenEstimateContext: { model: "deepseek-v4-flash" },
  };
}

function readEvidence(text: string) {
  return text.split("[tool=file_read]\n").slice(1).map((section) => JSON.parse(section.trim()));
}

describe("bounded multi-file objective review", () => {
  for (const [phase, build] of [
    ["review", buildWorkspaceMutationObjectiveReviewRequest],
    ["repair", buildWorkspaceMutationObjectiveOutputRepairRequest],
  ] as const) {
    it(`retains the relevant complete source line from every full read within the original ${phase} budget`, () => {
      const input = fixture();
      const originalMessages = JSON.stringify(input.messages);
      const request = build(input);
      expect(request).toBeDefined();
      expect(request!.estimatedInputTokens).toBeLessThanOrEqual(2048);
      expect(request!.missingRequiredSourceEvidencePaths).toEqual([]);
      expect(request!.tools).toEqual(input.tools);
      expect(request!.jsonObjectOutputRequired).toBe(true);
      const evidence = readEvidence(request!.messages[1].content);
      expect(evidence).toHaveLength(3);
      for (const [index, sourcePath] of requiredChangedPaths.entries()) {
        const item = evidence.find((read) => read.path === sourcePath);
        expect(item).toBeDefined();
        expect(item.truncated).toBe(false);
        expect(item.contentTruncatedForMutationRecovery).toBe(true);
        for (const target of targets[index]) {
          expect(item.taskRelevantContexts.some(({ context }: { context: string }) => context.includes(target))).toBe(true);
        }
      }
      expect(JSON.stringify(input.messages)).toBe(originalMessages);
    });

    it(`rejects ${phase} when a required read is missing or the total budget cannot hold source evidence`, () => {
      const input = fixture();
      expect(build({ ...input, messages: input.messages.slice(0, -2) })).toBeUndefined();
      expect(build({ ...input, maxInputTokens: 500 })).toBeUndefined();
    });
  }
});

describe("source line budget boundaries", () => {
  it.each(["\n", "\r\n"])("preserves exact source bytes and every identical occurrence with %j line endings", (newline) => {
    const sourceLine = `export { ${"SupportingType, ".repeat(7)}ResultCode };${newline}`;
    const padding = `// ${"unrelated ".repeat(24)}${newline}`;
    const contexts = [10, 50].map((start) => ({ identifier: "ResultCode", lines: `${start}-${start + 2}`,
      context: `${padding}${sourceLine}${padding}` }));
    const projected = fitWorkspaceMutationSourceContexts({ metadata: { path: "src/api.ts" }, contexts,
      maxTokens: 230, tokenEstimateContext: { model: "deepseek-v4-flash" } });
    expect(projected).not.toBe("");
    const evidence = JSON.parse(projected);
    expect(evidence.taskRelevantContexts).toEqual([{
      identifier: "ResultCode", lines: "11-11", context: sourceLine, contextTruncatedForBudget: true,
      additionalIdenticalSourceLineRanges: ["51-51"],
    }]);
    expect(contexts[0].context).toBe(`${padding}${sourceLine}${padding}`);
  });

  it("does not produce a partial source line when the relevant line cannot fit", () => {
    expect(fitWorkspaceMutationSourceContexts({ metadata: { path: "src/api.ts" },
      contexts: [{ identifier: "ResultCode", lines: "1-1", context: `export type ResultCode = ${"LongType | ".repeat(100)}never;` }],
      maxTokens: 100, tokenEstimateContext: { model: "deepseek-v4-flash" } })).toBe("");
  });

  it("does not invent line ranges for malformed source coordinates", () => {
    for (const lines of ["0-1", "2-1", "1-3", "9007199254740992-9007199254740992"]) {
      expect(fitWorkspaceMutationSourceContexts({ metadata: { path: "src/api.ts" },
        contexts: [{ identifier: "ResultCode", lines, context: `export type ResultCode = number;\n${"// unrelated source\n".repeat(30)}` }],
        maxTokens: 120, tokenEstimateContext: { model: "deepseek-v4-flash" } })).toBe("");
    }
  });

  it("keeps partial, anchored and inconsistent read metadata visible", () => {
    const read = { path: "src/api.ts", truncated: false, size: 100, bytesRead: 100,
      range: { offset: 0, endOffset: 100 }, encoding: "utf-8", revision: "a".repeat(64) };
    for (const changed of [
      { truncated: true }, { anchor: { text: "ResultCode" } }, { bytesRead: 50 },
      { range: { offset: 50, endOffset: 100 } }, { size: -1, bytesRead: -1, range: { offset: 0, endOffset: -1 } },
    ]) {
      const evidence = { ...read, ...changed };
      expect(compactWorkspaceMutationReadMetadata(evidence)).toBe(evidence);
    }
    expect(compactWorkspaceMutationReadMetadata(read)).toEqual({ path: "src/api.ts", truncated: false });
    expect(read.revision).toBe("a".repeat(64));
    expect(read.range).toEqual({ offset: 0, endOffset: 100 });
  });
});
