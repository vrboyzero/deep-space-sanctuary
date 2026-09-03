import { describe, expect, it } from "vitest";

import { rebuildSerializedFalseExpandedBranchToolCall } from "./react-workspace-mutation-serialized-false-correction.js";

const requiredPath = "src/diff/props.js";
const taskText = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
const expandedBranchPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t// aria- and data- attributes have no boolean representation.",
  "-\t\t// A `false` value is different from the attribute not being",
  "-\t\t// present, so we can't remove it. For non-boolean aria",
  "-\t\t// attributes we could treat false as a removal, but the",
  "-\t\t// amount of exceptions would cost too many bytes. On top of",
  "-\t\t// that other frameworks generally stringify `false`.",
  "-",
  "-\t\tif (typeof value == 'function') {",
  "-\t\t\t// never serialize functions as attribute values",
  "-\t\t} else if (value != NULL && value !== false) {",
  "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "-\t\t} else {",
  "-\t\t\tdom.removeAttribute(name);",
  "+\t\t// Serialize `false` for aria-* and data-* attributes (the string",
  "+\t\t// \"false\"), since for them a false value differs from absence and",
  "+\t\t// other frameworks generally stringify it. Ordinary attributes with a",
  "+\t\t// `false` value are removed, as are null/undefined values which remove",
  "+\t\t// every attribute.",
  "+",
  "+\t\tif (typeof value == 'function') {",
  "+\t\t\t// never serialize functions as attribute values",
  "+\t\t} else if (value == NULL) {",
  "+\t\t\tdom.removeAttribute(name);",
  "+\t\t} else if (value === false) {",
  "+\t\t\tif (name.length > 5 && (name.slice(0, 5) == 'aria-' || name.slice(0, 5) == 'data-')) {",
  "+\t\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : 'false');",
  "+\t\t\t} else {",
  "+\t\t\t\tdom.removeAttribute(name);",
  "+\t\t\t}",
  "+\t\t} else {",
  "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "+\t\t}",
  "*** End Patch",
].join("\n");
const expandedBranchSource = [
  "\t\t// Serialize `false` for aria-* and data-* attributes (the string",
  "\t\t// \"false\"), since for them a false value differs from absence and",
  "\t\t// other frameworks generally stringify it. Ordinary attributes with a",
  "\t\t// `false` value are removed, as are null/undefined values which remove",
  "\t\t// every attribute.",
  "",
  "\t\tif (typeof value == 'function') {",
  "\t\t\t// never serialize functions as attribute values",
  "\t\t} else if (value == NULL) {",
  "\t\t\tdom.removeAttribute(name);",
  "\t\t} else if (value === false) {",
  "\t\t\tif (name.length > 5 && (name.slice(0, 5) == 'aria-' || name.slice(0, 5) == 'data-')) {",
  "\t\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : 'false');",
  "\t\t\t} else {",
  "\t\t\t\tdom.removeAttribute(name);",
  "\t\t\t}",
  "\t\t} else {",
  "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
  "\t\t}",
  "\t\t}",
].join("\r\n");
const expandedBranchCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-\t\t\tif (name.length > 5 && (name.slice(0, 5) == 'aria-' || name.slice(0, 5) == 'data-')) {",
  "+\t\t\tif (name[4] == '-') {",
  "*** End Patch",
].join("\n");

describe("serialized-false expanded branch recovery", () => {
  it("reconstructs the frozen one-condition truth contract from the real post-write shape", () => {
    const rebuilt = rebuildSerializedFalseExpandedBranchToolCall(fixture());

    expect(rebuilt).toBeDefined();
    const patchInput = readPatchInput(rebuilt!);
    expect(patchInput).toContain("+\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {");
    expect(patchInput).toContain("+\t\t// aria- and data- attributes have no boolean representation.");
    expect(patchInput).toContain("+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);");
    expect(patchInput).toContain("+\t\t\tdom.removeAttribute(name);");
    expect(patchInput).not.toContain("+\t\t\tif (name.length");
    expect(patchInput).not.toContain("+\t\t} else if (value === false)");
  });

  it.each([
    ["task drift", (input: ReturnType<typeof fixture>) => ({ ...input, taskText: "Fix false values." })],
    ["path drift", (input: ReturnType<typeof fixture>) => ({ ...input, requiredPaths: ["src/diff/children.js"] })],
    ["prior patch drift", (input: ReturnType<typeof fixture>) => ({ ...input, priorSuccessfulPatchInputs: [] })],
    ["source drift", (input: ReturnType<typeof fixture>) => ({
      ...input,
      messages: sourceMessages(expandedBranchSource.replace("name.length > 5", "name.length >= 5")),
    })],
  ] as const)("fails closed for %s", (_name, mutate) => {
    expect(rebuildSerializedFalseExpandedBranchToolCall(mutate(fixture()))).toBeUndefined();
  });
});

function fixture() {
  return {
    toolCall: toolCall(expandedBranchCorrection),
    messages: sourceMessages(expandedBranchSource),
    taskText,
    priorSuccessfulPatchInputs: [expandedBranchPatch],
    requiredPaths: [requiredPath],
  };
}

function sourceMessages(source: string) {
  return [{
    role: "tool",
    content: JSON.stringify({ path: requiredPath, truncated: false, content: source }),
  }];
}

function toolCall(input: string) {
  return {
    id: "broad-correction",
    function: { name: "apply_patch", arguments: JSON.stringify({ input }) },
  };
}

function readPatchInput(toolCallValue: { function: { arguments: string } }): string {
  return (JSON.parse(toolCallValue.function.arguments) as { input: string }).input;
}
