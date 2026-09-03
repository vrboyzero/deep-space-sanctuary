import { describe, expect, it } from "vitest";

import { rebuildSerializedFalseSemanticNarrowingToolCall } from "./react-workspace-mutation-serialized-false-correction.js";
import {
  hasUnpreservedSerializedFalseWitnessCurrentSource,
  hasUnreachableSerializedFalseWitnessCurrentSource,
} from "./react-workspace-mutation.js";

const requiredPath = "src/diff/props.js";
const taskText = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
const functionGuard = "\t\tif (typeof value == 'function') {";
const functionComment = "\t\t\t// never serialize functions as attribute values";
const originalCondition = "\t\t} else if (value != NULL && value !== false) {";
const ordinarySetAttribute = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
const removalStatement = "\t\t\tdom.removeAttribute(name);";
const unconditionalFallback = "\t\t} else {";
const guardedFallback = "\t\t} else if (value !== false) {";
const branchEnd = "\t\t}";
const multilineBranchLines = [
  functionGuard,
  functionComment,
  "\t\t} else if (value == NULL) {",
  removalStatement,
  "\t\t} else if (",
  "\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
  "\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
  "\t\t) {",
  "\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
];
const broadSource = [
  ...multilineBranchLines,
  unconditionalFallback,
  ordinarySetAttribute,
  branchEnd,
].join("\r\n");
const correctedSource = [
  ...multilineBranchLines,
  guardedFallback,
  ordinarySetAttribute,
  unconditionalFallback,
  removalStatement,
  branchEnd,
].join("\r\n");
const initialPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  ` ${functionGuard}`,
  ` ${functionComment}`,
  `-${originalCondition}`,
  `-${ordinarySetAttribute}`,
  "+\t\t} else if (value == NULL) {",
  `+${removalStatement}`,
  "+\t\t} else if (",
  "+\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
  "+\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
  "+\t\t) {",
  "+\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
  ` ${unconditionalFallback}`,
  `-${removalStatement}`,
  `+${ordinarySetAttribute}`,
  ` ${branchEnd}`,
  "*** End Patch",
].join("\n");
const modelCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  `-${functionGuard}`,
  "+\t\tif (typeof value == 'function' || value === false) {",
  ` ${functionComment}`,
  "*** End Patch",
].join("\n");
const expectedCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  `-${unconditionalFallback}`,
  `-${ordinarySetAttribute}`,
  `+${guardedFallback}`,
  `+${ordinarySetAttribute}`,
  `+${unconditionalFallback}`,
  `+${removalStatement}`,
  ` ${branchEnd}`,
  "*** End Patch",
].join("\r\n");

describe("serialized-false multiline fallback recovery", () => {
  it("rebuilds only the ordinary fallback from bound complete current source", () => {
    const rebuilt = rebuildSerializedFalseSemanticNarrowingToolCall({
      toolCall: patchCall(modelCorrection),
      messages: sourceMessages(broadSource),
      taskText,
      priorSuccessfulPatchInputs: [initialPatch],
      requiredPaths: [requiredPath],
      correctionReason: undefined,
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({ input: expectedCorrection });
  });

  it.each([
    {
      name: "unrelated task",
      task: "Rename a variable with the smallest change.",
      messages: sourceMessages(broadSource),
      patches: [initialPatch],
      paths: [requiredPath],
    },
    {
      name: "multiple required paths",
      task: taskText,
      messages: sourceMessages(broadSource),
      patches: [initialPatch],
      paths: [requiredPath, "src/other.js"],
    },
    {
      name: "multiple prior mutations",
      task: taskText,
      messages: sourceMessages(broadSource),
      patches: [initialPatch, initialPatch],
      paths: [requiredPath],
    },
    {
      name: "unbound prior mutation",
      task: taskText,
      messages: sourceMessages(broadSource),
      patches: [initialPatch.replace(requiredPath, "src/other.js")],
      paths: [requiredPath],
    },
    {
      name: "truncated current source",
      task: taskText,
      messages: sourceMessages(broadSource, true),
      patches: [initialPatch],
      paths: [requiredPath],
    },
    {
      name: "changed data predicate",
      task: taskText,
      messages: sourceMessages(broadSource.replace("name[4] == '-'", "name[5] == '-'")),
      patches: [initialPatch],
      paths: [requiredPath],
    },
    {
      name: "already corrected fallback",
      task: taskText,
      messages: sourceMessages(correctedSource),
      patches: [initialPatch],
      paths: [requiredPath],
    },
  ])("does not rebuild with $name", ({ task, messages, patches, paths }) => {
    expect(rebuildSerializedFalseSemanticNarrowingToolCall({
      toolCall: patchCall(modelCorrection),
      messages,
      taskText: task,
      priorSuccessfulPatchInputs: patches,
      requiredPaths: paths,
      correctionReason: undefined,
    })).toBeUndefined();
  });

  it("distinguishes the broad fallback from the complete ordinary-false removal", () => {
    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(broadSource),
      taskText,
      [initialPatch],
    )).toBe(false);
    expect(hasUnpreservedSerializedFalseWitnessCurrentSource(
      sourceMessages(broadSource),
      taskText,
      [initialPatch],
    )).toBe(true);
    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(correctedSource),
      taskText,
      [initialPatch],
    )).toBe(false);
    expect(hasUnpreservedSerializedFalseWitnessCurrentSource(
      sourceMessages(correctedSource),
      taskText,
      [initialPatch],
    )).toBe(false);
  });

  it("fails closed for a guarded fallback without removal or an inexact data predicate", () => {
    const guardOnlySource = [
      ...multilineBranchLines,
      guardedFallback,
      ordinarySetAttribute,
      branchEnd,
    ].join("\r\n");
    const inexactDataSource = correctedSource.replace(
      "(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
      "name[0] == 'd'",
    );

    expect(hasUnpreservedSerializedFalseWitnessCurrentSource(
      sourceMessages(guardOnlySource),
      taskText,
      [initialPatch],
    )).toBe(true);
    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(inexactDataSource),
      taskText,
      [initialPatch],
    )).toBe(true);
  });

  it("accepts only a fully grouped multiline false-prefix branch", () => {
    const groupedSource = [
      originalCondition,
      ordinarySetAttribute,
      "\t\t} else if (",
      "\t\t\tvalue === false && (",
      "\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
      "\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
      "\t\t\t)",
      "\t\t) {",
      "\t\t\tdom.setAttribute(name, 'false');",
      unconditionalFallback,
      removalStatement,
      branchEnd,
    ].join("\n");

    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(groupedSource),
      taskText,
      [initialPatch],
    )).toBe(false);
    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(groupedSource.replace("value === false && (", "value === false &&")),
      taskText,
      [initialPatch],
    )).toBe(true);
    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(groupedSource.replace(
        "(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
        "name[0] == 'd'",
      )),
      taskText,
      [initialPatch],
    )).toBe(true);
  });
});

function patchCall(patch: string) {
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
