import { describe, expect, it } from "vitest";

import {
  hasSerializedFalseNullishSerializationCurrentSource,
  rebuildSerializedFalseSiblingDoubleElseToolCall,
  rebuildSerializedFalseSemanticNarrowingToolCall,
} from "./react-workspace-mutation-serialized-false-correction.js";

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
const nullishSerializationCondition = "\t\t} else if ((name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') || (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
const nullishSerializationStatement = "\t\t\tdom.setAttribute(name, value == NULL || value === false ? String(value) : value);";
const nullishSerializationSource = [
  "\t\t// aria- and data- attributes have no boolean representation, so a",
  "\t\t// false value is serialized as the string \"false\". Ordinary",
  "\t\t// attributes with false, null, or undefined values are removed.",
  "\t\tif (typeof value == 'function') {",
  "\t\t\t// never serialize functions as attribute values",
  nullishSerializationCondition,
  nullishSerializationStatement,
  "\t\t} else if (value != NULL && value !== false) {",
  "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "\t\t} else {",
  "\t\t\tdom.removeAttribute(name);",
  "\t\t}",
].join("\n");
const nullishSerializationPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "+\t\t// aria- and data- attributes have no boolean representation, so a",
  "+\t\t// false value is serialized as the string \"false\". Ordinary",
  "+\t\t// attributes with false, null, or undefined values are removed.",
  " \t\tif (typeof value == 'function') {",
  " \t\t\t// never serialize functions as attribute values",
  `+${nullishSerializationCondition}`,
  `+${nullishSerializationStatement}`,
  " \t\t} else if (value != NULL && value !== false) {",
  "*** End Patch",
].join("\n");
const reachableInlineCondition = "\t\t} else if (value != NULL && (value !== false || name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
const reachableInlineSource = [
  "\t\tif (typeof value == 'function') {",
  "\t\t\t// never serialize functions as attribute values",
  reachableInlineCondition,
  "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "\t\t} else {",
  "\t\t\tdom.removeAttribute(name);",
  "\t\t}",
].join("\n");
const reachableInlinePatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t} else if (value != NULL && value !== false) {",
  `+${reachableInlineCondition}`,
  " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "*** End Patch",
].join("\n");
const siblingDoubleElseCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\tif (typeof value == 'function') {",
  "-\t\t\t// never serialize functions as attribute values",
  `-${reachableInlineCondition}`,
  "+\t\tif (typeof value == 'function' || value == NULL || value === false && !(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {",
  "+\t\t\t// functions, null, undefined are never serialized; false removes ordinary attributes",
  "+\t\t} else {",
  " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "*** End Patch",
].join("\n");
const baselineInlineCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
const baselineInlineCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  `-${reachableInlineCondition}`,
  `+${baselineInlineCondition}`,
  "*** End Patch",
].join("\n");

describe("serialized-false semantic-narrowing correction", () => {
  it("rebuilds a direct sibling double-else correction as the source-derived baseline condition", () => {
    const rebuilt = rebuildSerializedFalseSiblingDoubleElseToolCall({
      toolCall: call(siblingDoubleElseCorrection),
      messages: sourceMessages(reachableInlineSource),
      taskText,
      priorSuccessfulPatchInputs: [reachableInlinePatch],
      requiredPaths: [requiredPath],
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({ input: baselineInlineCorrection });
  });

  it.each([
    {
      name: "unrelated task",
      toolCall: call(siblingDoubleElseCorrection),
      messages: sourceMessages(reachableInlineSource),
      task: "Rename a variable with the smallest change.",
      patches: [reachableInlinePatch],
      paths: [requiredPath],
    },
    {
      name: "multiple required paths",
      toolCall: call(siblingDoubleElseCorrection),
      messages: sourceMessages(reachableInlineSource),
      task: taskText,
      patches: [reachableInlinePatch],
      paths: [requiredPath, "src/other.js"],
    },
    {
      name: "unbound prior patch",
      toolCall: call(siblingDoubleElseCorrection),
      messages: sourceMessages(reachableInlineSource),
      task: taskText,
      patches: [reachableInlinePatch.replace(requiredPath, "src/other.js")],
      paths: [requiredPath],
    },
    {
      name: "newer truncated source",
      toolCall: call(siblingDoubleElseCorrection),
      messages: [
        ...sourceMessages(reachableInlineSource),
        ...sourceMessages(reachableInlineSource, true),
      ],
      task: taskText,
      patches: [reachableInlinePatch],
      paths: [requiredPath],
    },
    {
      name: "different current source",
      toolCall: call(siblingDoubleElseCorrection),
      messages: sourceMessages(reachableInlineSource.replace("name[4] == '-'", "name[5] == '-'")),
      task: taskText,
      patches: [reachableInlinePatch],
      paths: [requiredPath],
    },
    {
      name: "correction removes the following sibling else",
      toolCall: call(siblingDoubleElseCorrection.replace(
        " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
        " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);\n-\t\t} else {\n-\t\t\tdom.removeAttribute(name);",
      )),
      messages: sourceMessages(reachableInlineSource),
      task: taskText,
      patches: [reachableInlinePatch],
      paths: [requiredPath],
    },
  ])("does not rebuild sibling double-else with $name", ({
    toolCall,
    messages,
    task,
    patches,
    paths,
  }) => {
    expect(rebuildSerializedFalseSiblingDoubleElseToolCall({
      toolCall,
      messages,
      taskText: task,
      priorSuccessfulPatchInputs: patches,
      requiredPaths: paths,
    })).toBeUndefined();
  });

  it("detects the frozen nullish serialization branch only from bound complete current source", () => {
    expect(hasSerializedFalseNullishSerializationCurrentSource(
      sourceMessages(nullishSerializationSource),
      taskText,
      [nullishSerializationPatch],
      [requiredPath],
    )).toBe(true);
    expect(hasSerializedFalseNullishSerializationCurrentSource(
      [
        ...sourceMessages(nullishSerializationSource),
        ...sourceMessages(nullishSerializationSource, true),
      ],
      taskText,
      [nullishSerializationPatch],
      [requiredPath],
    )).toBe(false);
  });

  it.each([
    {
      name: "unrelated task",
      task: "Rename a variable with the smallest change.",
      patches: [nullishSerializationPatch],
      paths: [requiredPath],
      source: nullishSerializationSource,
    },
    {
      name: "multiple required paths",
      task: taskText,
      patches: [nullishSerializationPatch],
      paths: [requiredPath, "src/other.js"],
      source: nullishSerializationSource,
    },
    {
      name: "unbound prior patch",
      task: taskText,
      patches: [nullishSerializationPatch.replace(requiredPath, "src/other.js")],
      paths: [requiredPath],
      source: nullishSerializationSource,
    },
    {
      name: "different current source",
      task: taskText,
      patches: [nullishSerializationPatch],
      paths: [requiredPath],
      source: nullishSerializationSource.replace("String(value)", "'false'"),
    },
  ])("does not detect nullish serialization with $name", ({ task, patches, paths, source }) => {
    expect(hasSerializedFalseNullishSerializationCurrentSource(
      sourceMessages(source),
      task,
      patches,
      paths,
    )).toBe(false);
  });

  it("rebuilds the frozen nullish serialization branch as one atomic condition-and-statement replacement", () => {
    const rebuilt = rebuildSerializedFalseSemanticNarrowingToolCall({
      toolCall: call("*** Begin Patch\n*** Update File: src/diff/props.js\n@@\n-old\n+new\n*** End Patch"),
      messages: sourceMessages(nullishSerializationSource),
      taskText,
      priorSuccessfulPatchInputs: [nullishSerializationPatch],
      requiredPaths: [requiredPath],
      correctionReason: "serialized_false_nullish_serialization_requires_atomic_repair",
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({
      input: [
        "*** Begin Patch",
        `*** Update File: ${requiredPath}`,
        "@@",
        `-${nullishSerializationCondition}`,
        "+\t\t} else if (value === false && name[4] == '-') {",
        `-${nullishSerializationStatement}`,
        "+\t\t\tdom.setAttribute(name, 'false');",
        "*** End Patch",
      ].join("\n"),
    });
  });

  it("rebuilds the frozen formal input-error as one source-derived condition replacement", () => {
    const toolCall = call(malformedCorrection);

    const rebuilt = rebuildSerializedFalseSemanticNarrowingToolCall({
      toolCall,
      messages: sourceMessages(currentSource),
      taskText,
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath],
      correctionReason: "smallest_change_requires_semantic_narrowing",
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
      correctionReason: "smallest_change_requires_semantic_narrowing",
      ...input,
    })).toBeUndefined();
  });

  it("does not rebuild a nullish branch for the older semantic-narrowing reason", () => {
    expect(rebuildSerializedFalseSemanticNarrowingToolCall({
      toolCall: call("*** Begin Patch\n*** Update File: src/diff/props.js\n@@\n-old\n+new\n*** End Patch"),
      messages: sourceMessages(nullishSerializationSource),
      taskText,
      priorSuccessfulPatchInputs: [nullishSerializationPatch],
      requiredPaths: [requiredPath],
      correctionReason: "smallest_change_requires_semantic_narrowing",
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
