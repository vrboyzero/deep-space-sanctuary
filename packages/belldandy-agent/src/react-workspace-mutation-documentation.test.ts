import { describe, expect, it } from "vitest";

import { applyPatchTool } from "../../belldandy-skills/src/builtin/apply-patch/index.js";
import { readClippedLeadingDocumentation } from "./react-workspace-mutation-documentation.js";
import {
  buildWorkspaceMutationObjectiveOutputRepairRequest,
  buildWorkspaceMutationObjectiveReviewRequest,
} from "./react-workspace-mutation.js";

const documentation = [
  "/**",
  " * Return the remaining values after the requested offset.",
  " * The offset counts values that have already been consumed.",
  " * When no offset is specified, two values have already been consumed.",
  " * For example, the input values are [10, 20, 30, 40].",
  " * With the default offset the result is [30, 40].",
  " * With offset 3 the result is [40].",
  " *",
  " * @return {Array}",
  " * @public",
  " */",
].join("\n");
const declaration = [
  "pager.remaining = function remaining(values, offset = 2) {",
  "  return values.slice(offset + 1);",
  "};",
].join("\n");

function fixture(prefix = documentation) {
  const content = `${"// unrelated source\n".repeat(240)}${prefix}\n\n${declaration}\n${"// unrelated tail\n".repeat(200)}`;
  return {
    messages: [
      { role: "user", content: "Restore the documented pager.remaining offset behavior with the smallest change in src/pager.js. Return a JSON object with a summary." },
      { role: "assistant", tool_calls: [{ id: "read", function: { name: "file_read", arguments: '{"path":"src/pager.js"}' } }] },
      { role: "tool", tool_call_id: "read", content: JSON.stringify({ path: "src/pager.js", truncated: false, content }) },
    ],
    tools: [{ type: "function" as const, function: applyPatchTool.definition }],
    maxInputTokens: 2048,
    requiredChangedPaths: ["src/pager.js"],
    structuredOutputRequired: true,
    structuredOutputSchema: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
    validationMessage: "Output is not valid JSON.",
    tokenEstimateContext: { model: "deepseek-v4-flash" },
  };
}

function readContexts(text: string): string[] {
  const evidence = JSON.parse(text.split("[tool=file_read]\n")[1]);
  return evidence.taskRelevantContexts.map(({ context, leadingDocumentation }: { context: string; leadingDocumentation?: string }) => (leadingDocumentation ?? "") + context);
}

describe("post-write source documentation", () => {
  for (const [phase, build] of [
    ["objective review", buildWorkspaceMutationObjectiveReviewRequest],
    ["output repair", buildWorkspaceMutationObjectiveOutputRepairRequest],
  ] as const) {
    it(`keeps example inputs and outputs together with the current source in ${phase}`, () => {
      const request = build(fixture());
      expect(request).toBeDefined();
      expect(request!.estimatedInputTokens).toBeLessThanOrEqual(2048);
      const contexts = readContexts(request!.messages[1].content);
      expect(contexts.some((context) => context.includes(documentation) && context.includes(declaration))).toBe(true);
    });

    it(`keeps source evidence when a long comment cannot fit in ${phase}`, () => {
      const longDocumentation = documentation.replace(" * @return", `${" * Large documentation paragraph.\n".repeat(100)} * @return`);
      const request = build(fixture(longDocumentation));
      expect(request).toBeDefined();
      expect(request!.estimatedInputTokens).toBeLessThanOrEqual(2048);
      expect(readContexts(request!.messages[1].content).some((context) => context.includes(declaration))).toBe(true);
    });

    it(`drops optional documentation before current source under a tight budget in ${phase}`, () => {
      const requests = Array.from({ length: 41 }, (_, index) => 1000 + index * 25)
        .map((maxInputTokens) => ({ maxInputTokens, request: build({ ...fixture(), maxInputTokens }) }));
      const sourceOnly = requests.filter(({ request }) => request
        && readContexts(request.messages[1].content).some((context) => context.includes(declaration))
        && !request.messages[1].content.includes("leadingDocumentation"));
      expect(sourceOnly.length).toBeGreaterThan(0);
      for (const { request, maxInputTokens } of requests) {
        if (request) expect(request.estimatedInputTokens).toBeLessThanOrEqual(maxInputTokens);
      }
    });
  }

  it.each(["\n", "\r\n"])("preserves verbatim documentation with %j line endings", (newline) => {
    const comment = documentation.replaceAll("\n", newline);
    const source = `${comment}${newline}${declaration}`;
    const start = source.indexOf(" * With offset");
    expect(readClippedLeadingDocumentation(source, start, source.indexOf("function remaining"))).toBe(source.slice(0, start));
  });

  it.each([
    "// ordinary comment\n * With offset 3, return [40].\n */\n",
    "const unrelated = 1; /**\n * With offset 3, return [40].\n */\n",
    "/**\n * With offset 3, return [40].\n",
    "/**\n arbitrary non-comment line\n * With offset 3, return [40].\n */\n",
  ])("does not invent missing documentation from an ambiguous prefix", (prefix) => {
    const source = `${prefix}${declaration}`;
    expect(readClippedLeadingDocumentation(source, source.indexOf(" * With offset"), source.indexOf("function remaining"))).toBeUndefined();
  });
});
