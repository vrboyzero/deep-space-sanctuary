import { describe, expect, it } from "vitest";

import {
  buildWorkspaceMutationObjectiveInputCorrectionRequest,
  buildWorkspaceMutationObjectiveReviewRequest,
} from "./react-workspace-mutation.js";

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

function fileReadToolCall(id: string, path: string) {
  return {
    id,
    function: {
      name: "file_read",
      arguments: JSON.stringify({ path }),
    },
  };
}

function sourceEvidenceMessages(path: string, content: string) {
  return [
    {
      role: "assistant" as const,
      tool_calls: [fileReadToolCall(`read-${path.replace(/[^a-z0-9]/gi, "-")}`, path)],
    },
    {
      role: "tool" as const,
      tool_call_id: `read-${path.replace(/[^a-z0-9]/gi, "-")}`,
      content: JSON.stringify({ path, truncated: false, content }),
    },
  ];
}

describe("workspace mutation objective review residual scan", () => {
  it("surfaces per-path residual counts and first line numbers in the objective review request", () => {
    const content = [
      "package cobra",
      "func writeFlags() {",
      "\tWriteStringAndCheck(buf, \"flag_parsing_disabled=1\\n\")",
      "\tWriteStringAndCheck(buf, \"\\n\")",
      "}",
      "func gen() {",
      "\tWriteStringAndCheck(buf, \"last_command=%q\\n\")",
      "}",
    ].join("\n");
    const request = buildWorkspaceMutationObjectiveReviewRequest({
      maxInputTokens: 2_000,
      tools: [toolDefinition("apply_patch"), toolDefinition("file_read")],
      requiredChangedPaths: ["bash_completions.go"],
      requiredResidualIdentifiers: ["WriteStringAndCheck"],
      tokenEstimateContext: { model: "deepseek-v4-pro" },
      messages: [
        {
          role: "user",
          content: "Migrate the Go public API and remove every forbidden identifier.",
        },
        ...sourceEvidenceMessages("bash_completions.go", content),
      ],
    });

    expect(request).toBeDefined();
    const userText = request?.messages[1]?.content ?? "";
    expect(userText).toContain("Post-write residual scan");
    expect(userText).toContain("bash_completions.go: WriteStringAndCheck: 3 处");
    expect(userText).toContain("首次出现在行 3、4、7");
  });

  it("counts JSON-escaped evidence content without relying on raw newlines", () => {
    const request = buildWorkspaceMutationObjectiveReviewRequest({
      maxInputTokens: 2_000,
      tools: [toolDefinition("apply_patch"), toolDefinition("file_read")],
      requiredChangedPaths: ["bash_completions.go"],
      requiredResidualIdentifiers: ["WriteStringAndCheck"],
      tokenEstimateContext: { model: "deepseek-v4-pro" },
      messages: [
        {
          role: "user",
          content: "Migrate the Go public API and remove every forbidden identifier.",
        },
        {
          role: "assistant" as const,
          tool_calls: [fileReadToolCall("read-bash", "bash_completions.go")],
        },
        {
          role: "tool" as const,
          tool_call_id: "read-bash",
          // 模型视角的 JSON 转义证据：无真实换行，只有 \\n 转义。
          content: JSON.stringify({
            path: "bash_completions.go",
            truncated: false,
            content: "WriteStringAndCheck(a); WriteStringAndCheck(b); WriteStringAndCheck(c); WriteStringAndCheck(d); WriteStringAndCheck(e);",
          }),
        },
      ],
    });

    expect(request).toBeDefined();
    const userText = request?.messages[1]?.content ?? "";
    expect(userText).toContain("WriteStringAndCheck: 5 处");
    expect(userText).not.toContain("首次出现在行");
  });

  it("reports a clean scan when no forbidden identifier remains", () => {
    const request = buildWorkspaceMutationObjectiveReviewRequest({
      maxInputTokens: 2_000,
      tools: [toolDefinition("apply_patch"), toolDefinition("file_read")],
      requiredChangedPaths: ["bash_completions.go"],
      requiredResidualIdentifiers: ["WriteStringAndCheck"],
      tokenEstimateContext: { model: "deepseek-v4-pro" },
      messages: [
        {
          role: "user",
          content: "Migrate the Go public API and remove every forbidden identifier.",
        },
        ...sourceEvidenceMessages("bash_completions.go", "WriteString(buf, \"done\\n\")\n"),
      ],
    });

    expect(request).toBeDefined();
    expect(request?.messages[1]?.content ?? "").toContain(
      "no forbidden identifier occurrences remain",
    );
  });

  it("omits the scan block when no residual identifiers are configured", () => {
    const request = buildWorkspaceMutationObjectiveReviewRequest({
      maxInputTokens: 2_000,
      tools: [toolDefinition("apply_patch"), toolDefinition("file_read")],
      requiredChangedPaths: ["bash_completions.go"],
      tokenEstimateContext: { model: "deepseek-v4-pro" },
      messages: [
        {
          role: "user",
          content: "Migrate the Go public API and remove every forbidden identifier.",
        },
        ...sourceEvidenceMessages("bash_completions.go", "WriteString(buf, \"done\\n\")\n"),
      ],
    });

    expect(request).toBeDefined();
    expect(request?.messages[1]?.content ?? "").not.toContain("Post-write residual scan");
  });

  it("surfaces the residual scan in the bounded post-write correction input request", () => {
    const request = buildWorkspaceMutationObjectiveInputCorrectionRequest({
      maxInputTokens: 2_000,
      tools: [toolDefinition("apply_patch"), toolDefinition("file_read")],
      requiredChangedPaths: ["bash_completions.go"],
      requiredResidualIdentifiers: ["WriteStringAndCheck"],
      tokenEstimateContext: { model: "deepseek-v4-pro" },
      messages: [
        {
          role: "user",
          content: "Migrate the Go public API and remove every forbidden identifier.",
        },
        ...sourceEvidenceMessages("bash_completions.go", "\tWriteStringAndCheck(buf, \"\\n\")\n"),
      ],
    });

    expect(request).toBeDefined();
    expect(request?.messages[1]?.content ?? "").toContain("WriteStringAndCheck: 1 处");
  });
});
