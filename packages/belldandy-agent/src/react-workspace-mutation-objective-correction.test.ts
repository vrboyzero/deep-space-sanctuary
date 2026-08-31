import { describe, expect, it } from "vitest";

import { rebuildClosingDelimiterDeletionOnlyToolCall } from "./react-workspace-mutation.js";

describe("closing-delimiter objective correction", () => {
  const requiredPath = "src/diff/props.js";
  const task = "Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values.";
  const priorPatch = [
    "*** Begin Patch",
    `*** Update File: ${requiredPath}`,
    "@@",
    "-\t\t} else if (value != NULL && value !== false) {",
    "+\t\t} else if (value === false) {",
    "+\t\t\t}",
    "+\t\t}",
    "*** End Patch",
  ].join("\n");
  const currentSource = [
    "export function setProperty(dom, name, value) {",
    "\tif (name == 'style') {",
    "\t\tdom.style.cssText = value;",
    "\t} else {",
    "\t\t} else if (value === false) {",
    "\t\t\tdom.setAttribute(name, 'false');",
    "\t\t}",
    "\t\t}",
    "\t}",
    "}",
  ].join("\n");
  const invalidCorrection = applyPatchToolCall("*** Begin Patch\n*** End Patch");

  it("uses the only prior-added delimiter that forms a unique current-source duplicate", () => {
    const rebuilt = rebuildClosingDelimiterDeletionOnlyToolCall({
      toolCall: invalidCorrection,
      messages: sourceEvidence(requiredPath, currentSource),
      taskText: task,
      priorSuccessfulPatchInputs: [priorPatch],
      requiredPaths: [requiredPath],
    });

    expect(readPatch(rebuilt)).toBe([
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else if (value === false) {",
      " \t\t\tdom.setAttribute(name, 'false');",
      " \t\t}",
      "-\t\t}",
      " \t}",
      " }",
      "*** End Patch",
    ].join("\n"));
  });

  it.each([
    {
      name: "an unrelated task",
      taskText: "Update the README heading.",
    },
    {
      name: "multiple required paths",
      requiredPaths: [requiredPath, "src/diff/index.js"],
    },
    {
      name: "no prior successful patch",
      priorSuccessfulPatchInputs: [],
    },
    {
      name: "truncated current source",
      messages: sourceEvidence(requiredPath, currentSource, true),
    },
    {
      name: "current-source path drift",
      messages: sourceEvidence("src/diff/other.js", currentSource),
    },
    {
      name: "no adjacent duplicate in current source",
      messages: sourceEvidence(requiredPath, currentSource.replace("\t\t}\n\t\t}", "\t\t}\n\t}")),
    },
    {
      name: "multiple prior-added delimiter duplicates in current source",
      messages: sourceEvidence(requiredPath, [
        "\t\t} else if (value === false) {",
        "\t\t\tdom.setAttribute(name, 'false');",
        "\t\t\t}",
        "\t\t\t}",
        "\t\t}",
        "\t\t}",
        "\t}",
        "}",
      ].join("\n")),
    },
  ])("fails closed for $name", (overrides) => {
    expect(rebuildClosingDelimiterDeletionOnlyToolCall({
      toolCall: invalidCorrection,
      messages: sourceEvidence(requiredPath, currentSource),
      taskText: task,
      priorSuccessfulPatchInputs: [priorPatch],
      requiredPaths: [requiredPath],
      ...overrides,
    })).toBeUndefined();
  });
});

function applyPatchToolCall(input: string) {
  return {
    function: {
      name: "apply_patch",
      arguments: JSON.stringify({ input }),
    },
  };
}

function sourceEvidence(path: string, content: string, truncated = false) {
  return [{
    role: "tool" as const,
    content: JSON.stringify({ path, truncated, content }),
  }];
}

function readPatch(toolCall: ReturnType<typeof applyPatchToolCall> | undefined): string | undefined {
  if (!toolCall) return undefined;
  return (JSON.parse(toolCall.function.arguments) as { input?: string }).input;
}
