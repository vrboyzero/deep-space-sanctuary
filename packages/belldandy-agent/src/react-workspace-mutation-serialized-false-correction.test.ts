import { describe, expect, it } from "vitest";

import { rebuildSerializedFalseSemanticNarrowingToolCall } from "./react-workspace-mutation-serialized-false-correction.js";

const requiredPath = "src/diff/props.js";
const taskText = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
const broadCondition = "\t\t} else if (value === false && (name[0] == 'a' || name[0] == 'd') && name.indexOf('-') > 0) {";
const narrowedCondition = "\t\t} else if (value === false && name[4] == '-') {";
const currentSource = [
  "\t\tif (typeof value == 'function') {",
  "\t\t\t// never serialize functions as attribute values",
  "\t\t} else if (value != NULL && value !== false) {",
  "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  broadCondition,
  "\t\t\t// aria- and data- attributes have no boolean representation;",
  "\t\t\tdom.setAttribute(name, 'false');",
  "\t\t} else {",
  "\t\t\tdom.removeAttribute(name);",
  "\t\t}",
].join("\n");
const initialPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t} else {",
  `+${broadCondition}`,
  "+\t\t\tdom.setAttribute(name, 'false');",
  "+\t\t} else {",
  "*** End Patch",
].join("\n");
const malformedCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t} else if (value === false && (name[0] == 'a' || name[0] == 'd') && ",
  "+\t\t} else if (value === false && name[4] == '-') {",
  "*** End Patch",
].join("\n");

describe("serialized-false semantic-narrowing correction", () => {
  it("rebuilds the frozen formal input-error as one source-derived condition replacement", () => {
    const toolCall = call(malformedCorrection);

    const rebuilt = rebuildSerializedFalseSemanticNarrowingToolCall({
      toolCall,
      messages: sourceMessages(currentSource),
      taskText,
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath],
    });

    expect(rebuilt).not.toBe(toolCall);
    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({
      input: [
        "*** Begin Patch",
        `*** Update File: ${requiredPath}`,
        "@@",
        `-${broadCondition}`,
        `+${narrowedCondition}`,
        "*** End Patch",
      ].join("\n"),
    });
  });

  it.each([
    {
      name: "unrelated task",
      taskText: "Rename a variable with the smallest change.",
      messages: sourceMessages(currentSource),
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath],
    },
    {
      name: "multiple required paths",
      taskText,
      messages: sourceMessages(currentSource),
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath, "src/other.js"],
    },
    {
      name: "truncated source evidence",
      taskText,
      messages: sourceMessages(currentSource, true),
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath],
    },
    {
      name: "newer truncated source after stale complete evidence",
      taskText,
      messages: [
        ...sourceMessages(currentSource),
        ...sourceMessages(currentSource, true),
      ],
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath],
    },
    {
      name: "different current predicate",
      taskText,
      messages: sourceMessages(currentSource.replace("name.indexOf('-') > 0", "name[4] == '-'")),
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath],
    },
    {
      name: "unbound prior mutation",
      taskText,
      messages: sourceMessages(currentSource),
      priorSuccessfulPatchInputs: ["*** Begin Patch\n*** Update File: src/other.js\n@@\n-old\n+new\n*** End Patch"],
      requiredPaths: [requiredPath],
    },
  ])("does not rebuild $name", (input) => {
    expect(rebuildSerializedFalseSemanticNarrowingToolCall({
      toolCall: call(malformedCorrection),
      ...input,
    })).toBeUndefined();
  });
});

function call(patch: string) {
  return {
    function: {
      name: "apply_patch",
      arguments: JSON.stringify({ input: patch }),
    },
  };
}

function sourceMessages(content: string, truncated = false) {
  return [{
    role: "tool",
    content: JSON.stringify({ path: requiredPath, truncated, content }),
  }];
}
