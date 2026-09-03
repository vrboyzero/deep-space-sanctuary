import { describe, expect, it } from "vitest";

import {
  rebuildSerializedFalseDroppedFallbackToolCall,
  rebuildSerializedFalseSemanticNarrowingToolCall,
} from "./react-workspace-mutation-serialized-false-correction.js";
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

describe("serialized-false dropped fallback recovery", () => {
  const narrowPredicate = "name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a'";
  const exactPredicate = "(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') || (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')";
  const stubSource = [
    "\t\tif (value == NULL) {",
    removalStatement,
    `\t\t} else if (${narrowPredicate}) {`,
    branchEnd,
  ].join("\n");
  const priorPatch = [
    "*** Begin Patch",
    `*** Update File: ${requiredPath}`,
    "@@",
    `-${functionGuard}`,
    `-${functionComment}`,
    `-${originalCondition}`,
    `-${ordinarySetAttribute}`,
    `-${unconditionalFallback}`,
    `-${removalStatement}`,
    "+\t\tif (value == NULL) {",
    `+${removalStatement}`,
    `+\t\t} else if (${narrowPredicate}) {`,
    "*** End Patch",
  ].join("\n");
  const regressedPatch = [
    "*** Begin Patch",
    `*** Update File: ${requiredPath}`,
    "@@",
    "-\t\tif (value == NULL) {",
    "+\t\tif (value == NULL) {",
    ` ${removalStatement}`,
    `-\t\t} else if (${narrowPredicate}) {`,
    `-${branchEnd}`,
    `+\t\t} else if (value === false && !(${narrowPredicate})) {`,
    `+${removalStatement}`,
    `+\t\t} else if (value === false && (${narrowPredicate})) {`,
    "+\t\t\tdom.setAttribute(name, 'false');",
    `+${branchEnd}`,
    " \t}",
    " }",
    "*** End Patch",
  ].join("\n");
  const restoredSource = [
    ...multilineBranchLines,
    guardedFallback,
    ordinarySetAttribute,
    unconditionalFallback,
    removalStatement,
    branchEnd,
  ].join("\n");
  const expectedPatch = [
    "*** Begin Patch",
    `*** Update File: ${requiredPath}`,
    "@@",
    "-\t\tif (value == NULL) {",
    `-${removalStatement}`,
    `-\t\t} else if (${narrowPredicate}) {`,
    `-${branchEnd}`,
    `+${functionGuard}`,
    `+${functionComment}`,
    "+\t\t} else if (value == NULL) {",
    `+${removalStatement}`,
    "+\t\t} else if (",
    "+\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
    "+\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
    "+\t\t) {",
    "+\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
    `+${guardedFallback}`,
    `+${ordinarySetAttribute}`,
    `+${unconditionalFallback}`,
    `+${removalStatement}`,
    `+${branchEnd}`,
    "*** End Patch",
  ].join("\n");
  const patchesWithAdditionalFileDirective = [
    {
      name: "Add File",
      addDirective: (patch: string) => patch.replace(
        "*** Begin Patch",
        "*** Begin Patch\n*** Add File: src/unexpected.js\n+export const unexpected = true;",
      ),
    },
    {
      name: "Delete File",
      addDirective: (patch: string) => patch.replace(
        "*** Begin Patch",
        "*** Begin Patch\n*** Delete File: src/unexpected.js",
      ),
    },
    {
      name: "Move to",
      addDirective: (patch: string) => patch.replace(
        `*** Update File: ${requiredPath}`,
        `*** Update File: ${requiredPath}\n*** Move to: src/unexpected.js`,
      ),
    },
  ];

  it("rebuilds the exact frozen output repair as a complete fallback branch", () => {
    const rebuilt = rebuildSerializedFalseDroppedFallbackToolCall({
      toolCall: patchCall(regressedPatch),
      messages: sourceMessages(stubSource),
      taskText,
      priorSuccessfulPatchInputs: [priorPatch],
      requiredPaths: [requiredPath],
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({ input: expectedPatch });
  });

  it("writes the normalized required path into the rebuilt patch", () => {
    const rebuilt = rebuildSerializedFalseDroppedFallbackToolCall({
      toolCall: patchCall(regressedPatch),
      messages: sourceMessages(stubSource),
      taskText,
      priorSuccessfulPatchInputs: [priorPatch],
      requiredPaths: [`./${requiredPath}`],
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({ input: expectedPatch });
  });

  it.each(patchesWithAdditionalFileDirective)(
    "does not rebuild when the prior patch contains an additional $name directive",
    ({ addDirective }) => {
      expect(rebuildSerializedFalseDroppedFallbackToolCall({
        toolCall: patchCall(regressedPatch),
        messages: sourceMessages(stubSource),
        taskText,
        priorSuccessfulPatchInputs: [addDirective(priorPatch)],
        requiredPaths: [requiredPath],
      })).toBeUndefined();
    },
  );

  it.each(patchesWithAdditionalFileDirective)(
    "does not rebuild when the proposed patch contains an additional $name directive",
    ({ addDirective }) => {
      expect(rebuildSerializedFalseDroppedFallbackToolCall({
        toolCall: patchCall(addDirective(regressedPatch)),
        messages: sourceMessages(stubSource),
        taskText,
        priorSuccessfulPatchInputs: [priorPatch],
        requiredPaths: [requiredPath],
      })).toBeUndefined();
    },
  );

  it.each([
    {
      name: "unrelated task",
      task: "Rename a variable with the smallest change.",
      messages: sourceMessages(stubSource),
      patches: [priorPatch],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "multiple required paths",
      task: taskText,
      messages: sourceMessages(stubSource),
      patches: [priorPatch],
      paths: [requiredPath, "src/other.js"],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "multiple prior mutations",
      task: taskText,
      messages: sourceMessages(stubSource),
      patches: [priorPatch, priorPatch],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "unbound prior mutation",
      task: taskText,
      messages: sourceMessages(stubSource),
      patches: [priorPatch.replace(requiredPath, "src/other.js")],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "non-canonical prior path",
      task: taskText,
      messages: sourceMessages(stubSource),
      patches: [priorPatch.replace(requiredPath, `./${requiredPath}`)],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "changed prior baseline",
      task: taskText,
      messages: sourceMessages(stubSource),
      patches: [priorPatch.replace("typeof value == 'function'", "typeof value === 'function'")],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "truncated current source",
      task: taskText,
      messages: sourceMessages(stubSource, true),
      patches: [priorPatch],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "changed current prefix",
      task: taskText,
      messages: sourceMessages(stubSource.replace("name[1] == 'r'", "name[1] == 'x'")),
      patches: [priorPatch],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
    {
      name: "changed proposed prefix",
      task: taskText,
      messages: sourceMessages(stubSource),
      patches: [priorPatch],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch.replace("name[1] == 'r'", "name[1] == 'x'")),
    },
    {
      name: "non-canonical proposed path",
      task: taskText,
      messages: sourceMessages(stubSource),
      patches: [priorPatch],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch.replace(requiredPath, `./${requiredPath}`)),
    },
    {
      name: "already restored source",
      task: taskText,
      messages: sourceMessages(restoredSource),
      patches: [priorPatch],
      paths: [requiredPath],
      toolCall: patchCall(regressedPatch),
    },
  ])("does not rebuild with $name", ({ task, messages, patches, paths, toolCall }) => {
    expect(rebuildSerializedFalseDroppedFallbackToolCall({
      toolCall,
      messages,
      taskText: task,
      priorSuccessfulPatchInputs: patches,
      requiredPaths: paths,
    })).toBeUndefined();
  });

  it("rejects narrow prefixes and exact prefixes when the baseline fallback remains dropped", () => {
    const regressedSource = [
      "\t\tif (value == NULL) {",
      removalStatement,
      `\t\t} else if (value === false && !(${narrowPredicate})) {`,
      removalStatement,
      `\t\t} else if (value === false && (${narrowPredicate})) {`,
      "\t\t\tdom.setAttribute(name, 'false');",
      branchEnd,
    ].join("\n");
    const exactButDroppedSource = regressedSource.replaceAll(narrowPredicate, exactPredicate);

    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(regressedSource),
      taskText,
      [priorPatch],
    )).toBe(true);
    expect(hasUnpreservedSerializedFalseWitnessCurrentSource(
      sourceMessages(regressedSource),
      taskText,
      [priorPatch],
    )).toBe(true);
    expect(hasUnpreservedSerializedFalseWitnessCurrentSource(
      sourceMessages(exactButDroppedSource),
      taskText,
      [priorPatch],
    )).toBe(true);
    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(restoredSource),
      taskText,
      [priorPatch],
    )).toBe(false);
    expect(hasUnpreservedSerializedFalseWitnessCurrentSource(
      sourceMessages(restoredSource),
      taskText,
      [priorPatch],
    )).toBe(false);
  });
});

describe("serialized-false accepted post-write shapes", () => {
  const exactPrefixCondition = "\t\t} else if (value != NULL && (value !== false || (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') || (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-'))) {";
  const regexCondition = "\t\t} else if (value === false && /^(aria-|data-)/.test(name)) {";
  const cases = [
    {
      name: "Windows a1 inline exact prefixes",
      source: [
        functionGuard,
        functionComment,
        exactPrefixCondition,
        ordinarySetAttribute,
        unconditionalFallback,
        removalStatement,
        branchEnd,
      ].join("\n"),
      patch: [
        "*** Begin Patch",
        `*** Update File: ${requiredPath}`,
        "@@",
        `-${originalCondition}`,
        `+${exactPrefixCondition}`,
        "*** End Patch",
      ].join("\n"),
    },
    {
      name: "WSL2 a2 regex prefixes",
      source: [
        functionGuard,
        functionComment,
        originalCondition,
        ordinarySetAttribute,
        regexCondition,
        "\t\t\tdom.setAttribute(name, 'false');",
        unconditionalFallback,
        removalStatement,
        branchEnd,
      ].join("\n"),
      patch: [
        "*** Begin Patch",
        `*** Update File: ${requiredPath}`,
        "@@",
        ` ${originalCondition}`,
        ` ${ordinarySetAttribute}`,
        `+${regexCondition}`,
        "+\t\t\tdom.setAttribute(name, 'false');",
        "*** End Patch",
      ].join("\n"),
    },
    {
      name: "WSL2 a3 normalized alias",
      source: [
        "\t\tconst normalized = value == NULL || typeof value == 'function' ? NULL : value;",
        "\t\tif (normalized == NULL) {",
        removalStatement,
        "\t\t} else if (normalized === false) {",
        "\t\t\tif (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {",
        "\t\t\t\tdom.setAttribute(name, 'false');",
        "\t\t\t} else if (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
        "\t\t\t\tdom.setAttribute(name, 'false');",
        "\t\t\t} else {",
        "\t\t\t\tdom.removeAttribute(name);",
        "\t\t\t}",
        unconditionalFallback,
        "\t\t\tdom.setAttribute(name, name == 'popover' && normalized == true ? '' : normalized);",
        branchEnd,
      ].join("\n"),
      patch: [
        "*** Begin Patch",
        `*** Update File: ${requiredPath}`,
        "@@",
        `-${functionGuard}`,
        `-${functionComment}`,
        `-${originalCondition}`,
        `-${ordinarySetAttribute}`,
        `-${unconditionalFallback}`,
        `-${removalStatement}`,
        "+\t\tconst normalized = value == NULL || typeof value == 'function' ? NULL : value;",
        "+\t\tif (normalized == NULL) {",
        `+${removalStatement}`,
        "+\t\t} else if (normalized === false) {",
        "+\t\t\tif (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {",
        "+\t\t\t\tdom.setAttribute(name, 'false');",
        "+\t\t\t} else if (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
        "+\t\t\t\tdom.setAttribute(name, 'false');",
        "+\t\t\t} else {",
        "+\t\t\t\tdom.removeAttribute(name);",
        "+\t\t\t}",
        `+${unconditionalFallback}`,
        "+\t\t\tdom.setAttribute(name, name == 'popover' && normalized == true ? '' : normalized);",
        "*** End Patch",
      ].join("\n"),
    },
  ];

  it.each(cases)("accepts $name", ({ source, patch }) => {
    const messages = sourceMessages(source);

    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      messages,
      taskText,
      [patch],
    )).toBe(false);
    expect(hasUnpreservedSerializedFalseWitnessCurrentSource(
      messages,
      taskText,
      [patch],
    )).toBe(false);
  });

  it.each([
    {
      name: "missing nullish normalization",
      source: cases[2]!.source.replace(
        "value == NULL || typeof value == 'function'",
        "typeof value == 'function'",
      ),
    },
    {
      name: "inexact data prefix",
      source: cases[2]!.source.replace(
        "name[3] == 'a' && name[4] == '-'",
        "name[3] == 'a'",
      ),
    },
    {
      name: "ordinary false is serialized",
      source: cases[2]!.source.replace(
        "\t\t\t\tdom.removeAttribute(name);\n\t\t\t}\n\t\t} else {",
        "\t\t\t\tdom.setAttribute(name, 'false');\n\t\t\t}\n\t\t} else {",
      ),
    },
  ])("rejects normalized alias with $name", ({ source }) => {
    expect(hasUnreachableSerializedFalseWitnessCurrentSource(
      sourceMessages(source),
      taskText,
      [cases[2]!.patch],
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
