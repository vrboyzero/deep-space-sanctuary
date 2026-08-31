import { describe, expect, it } from "vitest";

import {
  hasSerializedFalseNullishSerializationCurrentSource,
  rebuildSerializedFalseBroadFirstCharacterToolCall,
  rebuildSerializedFalseNarrowArPrefixToolCall,
  rebuildSerializedFalseNestedUnreachableToolCall,
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
const broadFirstCharacterInitialPredicate = "\t\t\t(value !== false || (name[0] == 'a' && name[0] == 'a'))";
const broadFirstCharacterPredicate = "\t\t\t(value !== false || name[0] == 'a' || name[0] == 'd')";
const broadFirstCharacterInitialSource = [
  "\t\tif (typeof value == 'function') {",
  "\t\t\t// never serialize functions as attribute values",
  "\t\t} else if (",
  "\t\t\tvalue != NULL &&",
  broadFirstCharacterInitialPredicate,
  "\t\t) {",
  "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "\t\t} else {",
  "\t\t\tdom.removeAttribute(name);",
  "\t\t}",
].join("\n");
const broadFirstCharacterInitialPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t} else if (value != NULL && value !== false) {",
  "+\t\t} else if (",
  "+\t\t\tvalue != NULL &&",
  `+${broadFirstCharacterInitialPredicate}`,
  "+\t\t) {",
  " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "*** End Patch",
].join("\n");
const broadFirstCharacterCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  " \t\t} else if (",
  " \t\t\tvalue != NULL &&",
  `-${broadFirstCharacterInitialPredicate}`,
  `+${broadFirstCharacterPredicate}`,
  " \t\t) {",
  "*** End Patch",
].join("\n");
const broadFirstCharacterBaselineCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t} else if (",
  "-\t\t\tvalue != NULL &&",
  `-${broadFirstCharacterInitialPredicate}`,
  "-\t\t) {",
  `+${baselineInlineCondition}`,
  "*** End Patch",
].join("\n");
const nestedRemovalCondition = "\t\t} else if (value == NULL || value === false) {";
const nestedPrefixCondition = "\t\t\tif (name.slice(0, 5) == 'aria-' || name.slice(0, 5) == 'data-') {";
const nestedUnreachableCondition = "\t\t\tif (value === false && (name.slice(0, 5) == 'aria-' || name.slice(0, 5) == 'data-')) {";
const nestedSerializationStatement = "\t\t\t\tdom.setAttribute(name, String(value));";
const nestedFallbackStatement = "\t\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
const nestedInitialSource = [
  "\t\tif (typeof value == 'function') {",
  "\t\t\t// never serialize functions as attribute values",
  nestedRemovalCondition,
  "\t\t\tdom.removeAttribute(name);",
  "\t\t} else {",
  nestedPrefixCondition,
  nestedSerializationStatement,
  "\t\t\t} else {",
  nestedFallbackStatement,
  "\t\t\t}",
  "\t\t}",
].join("\n");
const nestedInitialPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t} else if (value != NULL && value !== false) {",
  "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  `+${nestedRemovalCondition}`,
  "+\t\t\tdom.removeAttribute(name);",
  " \t\t} else {",
  "-\t\t\tdom.removeAttribute(name);",
  `+${nestedPrefixCondition}`,
  `+${nestedSerializationStatement}`,
  "+\t\t\t} else {",
  `+${nestedFallbackStatement}`,
  "+\t\t\t}",
  " \t\t}",
  "*** End Patch",
].join("\n");
const nestedUnreachableCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  " \t\t} else if (value == NULL || value === false) {",
  " \t\t\tdom.removeAttribute(name);",
  " \t\t} else {",
  `-${nestedPrefixCondition}`,
  `+${nestedUnreachableCondition}`,
  ` ${nestedSerializationStatement}`,
  "*** End Patch",
].join("\n");
const nestedBaselineCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  `-${nestedRemovalCondition}`,
  "-\t\t\tdom.removeAttribute(name);",
  "-\t\t} else {",
  `-${nestedPrefixCondition}`,
  `-${nestedSerializationStatement}`,
  "-\t\t\t} else {",
  `-${nestedFallbackStatement}`,
  "-\t\t\t}",
  `+${baselineInlineCondition}`,
  "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "*** End Patch",
].join("\n");
const narrowPrefixPrimaryCondition = "\t\t} else if (value != NULL && value !== false) {";
const narrowPrefixInitialCondition = "\t\t} else if (value === false && (name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a')) {";
const narrowArPrefixCondition = "\t\t} else if (value === false && (name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
const narrowPrefixSource = [
  "\t\tif (typeof value == 'function') {",
  "\t\t\t// never serialize functions as attribute values",
  narrowPrefixPrimaryCondition,
  "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  narrowPrefixInitialCondition,
  "\t\t\tdom.setAttribute(name, 'false');",
  "\t\t} else {",
  "\t\t\tdom.removeAttribute(name);",
  "\t\t}",
].join("\n");
const narrowPrefixInitialPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\tif (typeof value == 'function') {",
  "-\t\t\t// never serialize functions as attribute values",
  `-${narrowPrefixPrimaryCondition}`,
  "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "-\t\t} else {",
  "-\t\t\tdom.removeAttribute(name);",
  "-\t\t}",
  "+\t\tif (typeof value == 'function') {",
  "+\t\t\t// never serialize functions as attribute values",
  `+${narrowPrefixPrimaryCondition}`,
  "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  `+${narrowPrefixInitialCondition}`,
  "+\t\t\tdom.setAttribute(name, 'false');",
  "+\t\t} else {",
  "+\t\t\tdom.removeAttribute(name);",
  "+\t\t}",
  "*** End Patch",
].join("\n");
const narrowArPrefixCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  `-${narrowPrefixInitialCondition}`,
  `+${narrowArPrefixCondition}`,
  "*** End Patch",
].join("\n");
const narrowPrefixBaselineCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  `-${narrowPrefixPrimaryCondition}`,
  "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  `-${narrowPrefixInitialCondition}`,
  "-\t\t\tdom.setAttribute(name, 'false');",
  `+${baselineInlineCondition}`,
  "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "*** End Patch",
].join("\n");

describe("serialized-false semantic-narrowing correction", () => {
  it("rebuilds the frozen narrow ar-prefix correction from complete current source", () => {
    const rebuilt = rebuildSerializedFalseNarrowArPrefixToolCall({
      toolCall: call(narrowArPrefixCorrection),
      messages: sourceMessages(narrowPrefixSource),
      taskText,
      priorSuccessfulPatchInputs: [narrowPrefixInitialPatch],
      requiredPaths: [requiredPath],
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({
      input: narrowPrefixBaselineCorrection,
    });
  });

  it.each([
    {
      name: "unrelated task",
      task: "Rename a variable with the smallest change.",
      messages: sourceMessages(narrowPrefixSource),
      patches: [narrowPrefixInitialPatch],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection,
    },
    {
      name: "multiple required paths",
      task: taskText,
      messages: sourceMessages(narrowPrefixSource),
      patches: [narrowPrefixInitialPatch],
      paths: [requiredPath, "src/other.js"],
      correction: narrowArPrefixCorrection,
    },
    {
      name: "unbound prior patch",
      task: taskText,
      messages: sourceMessages(narrowPrefixSource),
      patches: [narrowPrefixInitialPatch.replace(requiredPath, "src/other.js")],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection,
    },
    {
      name: "non-contiguous prior patch",
      task: taskText,
      messages: sourceMessages(narrowPrefixSource),
      patches: [narrowPrefixInitialPatch.replace(
        `+${narrowPrefixInitialCondition}`,
        "+\t\t\tconst unrelated = true;\n" + `+${narrowPrefixInitialCondition}`,
      )],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection,
    },
    {
      name: "newer truncated source",
      task: taskText,
      messages: [
        ...sourceMessages(narrowPrefixSource),
        ...sourceMessages(narrowPrefixSource, true),
      ],
      patches: [narrowPrefixInitialPatch],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection,
    },
    {
      name: "source drift",
      task: taskText,
      messages: sourceMessages(narrowPrefixSource.replace("'false'", "String(value)")),
      patches: [narrowPrefixInitialPatch],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection,
    },
    {
      name: "duplicate matching branch",
      task: taskText,
      messages: sourceMessages(`${narrowPrefixSource}\n${narrowPrefixSource}`),
      patches: [narrowPrefixInitialPatch],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection,
    },
    {
      name: "legal baseline correction",
      task: taskText,
      messages: sourceMessages(narrowPrefixSource),
      patches: [narrowPrefixInitialPatch],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection.replace(narrowArPrefixCondition, baselineInlineCondition),
    },
    {
      name: "non-contiguous correction context",
      task: taskText,
      messages: sourceMessages(narrowPrefixSource),
      patches: [narrowPrefixInitialPatch],
      paths: [requiredPath],
      correction: narrowArPrefixCorrection.replace(
        `-${narrowPrefixInitialCondition}`,
        `-${narrowPrefixInitialCondition}\n unrelated context`,
      ),
    },
  ])("does not rebuild narrow ar-prefix correction with $name", ({
    task,
    messages,
    patches,
    paths,
    correction,
  }) => {
    expect(rebuildSerializedFalseNarrowArPrefixToolCall({
      toolCall: call(correction),
      messages,
      taskText: task,
      priorSuccessfulPatchInputs: patches,
      requiredPaths: paths,
    })).toBeUndefined();
  });

  it("rebuilds the frozen nested unreachable-false correction from complete current source", () => {
    const rebuilt = rebuildSerializedFalseNestedUnreachableToolCall({
      toolCall: call(nestedUnreachableCorrection),
      messages: sourceMessages(nestedInitialSource),
      taskText,
      priorSuccessfulPatchInputs: [nestedInitialPatch],
      requiredPaths: [requiredPath],
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({
      input: nestedBaselineCorrection,
    });
  });

  it.each([
    {
      name: "unrelated task",
      task: "Rename a variable with the smallest change.",
      messages: sourceMessages(nestedInitialSource),
      patches: [nestedInitialPatch],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "multiple required paths",
      task: taskText,
      messages: sourceMessages(nestedInitialSource),
      patches: [nestedInitialPatch],
      paths: [requiredPath, "src/other.js"],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "unbound prior patch",
      task: taskText,
      messages: sourceMessages(nestedInitialSource),
      patches: [nestedInitialPatch.replace(requiredPath, "src/other.js")],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "non-contiguous prior patch",
      task: taskText,
      messages: sourceMessages(nestedInitialSource),
      patches: [nestedInitialPatch.replace(
        `+${nestedSerializationStatement}`,
        `+${nestedSerializationStatement}\n+\t\t\tconst unrelated = true;`,
      )],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "newer truncated source",
      task: taskText,
      messages: [
        ...sourceMessages(nestedInitialSource),
        ...sourceMessages(nestedInitialSource, true),
      ],
      patches: [nestedInitialPatch],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "source drift",
      task: taskText,
      messages: sourceMessages(nestedInitialSource.replace("String(value)", "'false'")),
      patches: [nestedInitialPatch],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "outer control-flow drift",
      task: taskText,
      messages: sourceMessages(`${nestedInitialSource.slice(0, -4)}\t\t} else {`),
      patches: [nestedInitialPatch],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "duplicate matching branch",
      task: taskText,
      messages: sourceMessages(`${nestedInitialSource}\n${nestedInitialSource}`),
      patches: [nestedInitialPatch],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection,
    },
    {
      name: "legal baseline correction",
      task: taskText,
      messages: sourceMessages(nestedInitialSource),
      patches: [nestedInitialPatch],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection.replace(
        nestedUnreachableCondition,
        baselineInlineCondition,
      ),
    },
    {
      name: "non-contiguous correction context",
      task: taskText,
      messages: sourceMessages(nestedInitialSource),
      patches: [nestedInitialPatch],
      paths: [requiredPath],
      correction: nestedUnreachableCorrection.replace(
        " \t\t\tdom.removeAttribute(name);",
        " \t\t\tdom.removeAttribute(name);\n unrelated context",
      ),
    },
  ])("does not rebuild nested unreachable correction with $name", ({
    task,
    messages,
    patches,
    paths,
    correction,
  }) => {
    expect(rebuildSerializedFalseNestedUnreachableToolCall({
      toolCall: call(correction),
      messages,
      taskText: task,
      priorSuccessfulPatchInputs: patches,
      requiredPaths: paths,
    })).toBeUndefined();
  });

  it("rebuilds the frozen broad first-character correction from complete current source", () => {
    const rebuilt = rebuildSerializedFalseBroadFirstCharacterToolCall({
      toolCall: call(broadFirstCharacterCorrection),
      messages: sourceMessages(broadFirstCharacterInitialSource),
      taskText,
      priorSuccessfulPatchInputs: [broadFirstCharacterInitialPatch],
      requiredPaths: [requiredPath],
    });

    expect(JSON.parse(rebuilt!.function.arguments)).toEqual({
      input: broadFirstCharacterBaselineCorrection,
    });
  });

  it.each([
    {
      name: "unrelated task",
      toolCall: call(broadFirstCharacterCorrection),
      messages: sourceMessages(broadFirstCharacterInitialSource),
      task: "Rename a variable with the smallest change.",
      patches: [broadFirstCharacterInitialPatch],
      paths: [requiredPath],
    },
    {
      name: "multiple required paths",
      toolCall: call(broadFirstCharacterCorrection),
      messages: sourceMessages(broadFirstCharacterInitialSource),
      task: taskText,
      patches: [broadFirstCharacterInitialPatch],
      paths: [requiredPath, "src/other.js"],
    },
    {
      name: "unbound prior patch",
      toolCall: call(broadFirstCharacterCorrection),
      messages: sourceMessages(broadFirstCharacterInitialSource),
      task: taskText,
      patches: [broadFirstCharacterInitialPatch.replace(requiredPath, "src/other.js")],
      paths: [requiredPath],
    },
    {
      name: "non-contiguous prior patch shape",
      toolCall: call(broadFirstCharacterCorrection),
      messages: sourceMessages(broadFirstCharacterInitialSource),
      task: taskText,
      patches: [broadFirstCharacterInitialPatch.replace(
        "+\t\t\tvalue != NULL &&",
        "+\t\t\tconst unrelated = true;\n+\t\t\tvalue != NULL &&",
      )],
      paths: [requiredPath],
    },
    {
      name: "newer truncated source",
      toolCall: call(broadFirstCharacterCorrection),
      messages: [
        ...sourceMessages(broadFirstCharacterInitialSource),
        ...sourceMessages(broadFirstCharacterInitialSource, true),
      ],
      task: taskText,
      patches: [broadFirstCharacterInitialPatch],
      paths: [requiredPath],
    },
    {
      name: "different current source",
      toolCall: call(broadFirstCharacterCorrection),
      messages: sourceMessages(broadFirstCharacterInitialSource.replace(
        "name[0] == 'a' && name[0] == 'a'",
        "name[0] == 'a' && name[1] == 'r'",
      )),
      task: taskText,
      patches: [broadFirstCharacterInitialPatch],
      paths: [requiredPath],
    },
    {
      name: "legal baseline correction",
      toolCall: call(broadFirstCharacterCorrection.replace(
        broadFirstCharacterPredicate,
        "\t\t\t(value !== false || name[4] == '-')",
      )),
      messages: sourceMessages(broadFirstCharacterInitialSource),
      task: taskText,
      patches: [broadFirstCharacterInitialPatch],
      paths: [requiredPath],
    },
    {
      name: "non-contiguous correction context",
      toolCall: call(broadFirstCharacterCorrection.replace(
        " \t\t\tvalue != NULL &&",
        " \t\t\tvalue != NULL &&\n context from another hunk",
      )),
      messages: sourceMessages(broadFirstCharacterInitialSource),
      task: taskText,
      patches: [broadFirstCharacterInitialPatch],
      paths: [requiredPath],
    },
  ])("does not rebuild broad first-character correction with $name", ({
    toolCall,
    messages,
    task,
    patches,
    paths,
  }) => {
    expect(rebuildSerializedFalseBroadFirstCharacterToolCall({
      toolCall,
      messages,
      taskText: task,
      priorSuccessfulPatchInputs: patches,
      requiredPaths: paths,
    })).toBeUndefined();
  });

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
