import { describe, expect, it } from "vitest";

import {
  rebuildExpressSubdomainOffsetCorrectionToolCall,
  recoverExpressSubdomainOffsetCompletionOutput,
} from "./react-workspace-mutation-js-bug-fix.js";

const requiredPath = "lib/request.js";
const taskText = [
  "Reproduce the frozen JavaScript regression in the real repository, implement the smallest safe fix, and preserve the existing test contract.",
  "The frozen regression is covered by test/benchmark-v3/real-js-bug-fix.js.",
  "Restore the documented req.subdomains offset behavior with the smallest change in lib/request.js.",
  "Do not modify tests, dependencies, package metadata, or any other source file.",
  "Return exactly one JSON object with a non-empty summary.",
].join(" ");
const initialPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  " defineGetter(req, 'subdomains', function subdomains() {",
  "   var hostname = this.hostname;",
  " ",
  "   if (!hostname) return [];",
  " ",
  "   var offset = this.app.get('subdomain offset');",
  "-  var subdomains = !isIP(hostname)",
  "-    ? hostname.split('.').reverse()",
  "-    : [hostname];",
  "-",
  "-  return subdomains.slice(offset + 1);",
  "+  var subdomains = !isIP(hostname)",
  "+    ? hostname.split('.')",
  "+    : [hostname];",
  "+",
  "+  return subdomains.slice(0, subdomains.length - offset - 1).reverse();",
  " });",
  "*** End Patch",
].join("\n");
const destructiveCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  " defineGetter(req, 'subdomains', function subdomains() {",
  "   var hostname = this.hostname;",
  " ",
  "   if (!hostname) return [];",
  " ",
  "   var offset = this.app.get('subdomain offset');",
  "+  var val = hostname.split('.').reverse();",
  "+  while (offset-- > 0) {",
  "+    val.shift();",
  "+  }",
  "+  return val;",
  "-  var subdomains = !isIP(hostname)",
  "-    ? hostname.split('.')",
  "-    : [hostname];",
  "-",
  "-  return subdomains.slice(0, subdomains.length - offset - 1).reverse();",
  " });",
  "*** End Patch",
].join("\n");
const currentSource = [
  "var isIP = require('node:net').isIP;",
  "",
  "defineGetter(req, 'subdomains', function subdomains() {",
  "  var hostname = this.hostname;",
  "",
  "  if (!hostname) return [];",
  "",
  "  var offset = this.app.get('subdomain offset');",
  "  var subdomains = !isIP(hostname)",
  "    ? hostname.split('.')",
  "    : [hostname];",
  "",
  "  return subdomains.slice(0, subdomains.length - offset - 1).reverse();",
  "});",
].join("\r\n");
const directFixPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-  return subdomains.slice(offset + 1);",
  "+  return subdomains.slice(offset);",
  "*** End Patch",
].join("\n");
const completedSource = currentSource
  .replace("hostname.split('.')", "hostname.split('.').reverse()")
  .replace(
    "subdomains.slice(0, subdomains.length - offset - 1).reverse()",
    "subdomains.slice(offset)",
  );
const branchedOffsetInitialPatch = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-  var offset = this.app.get('subdomain offset');",
  "   var subdomains = !isIP(hostname)",
  "     ? hostname.split('.').reverse()",
  "     : [hostname];",
  " ",
  "-  return subdomains.slice(offset + 1);",
  "+  var offset = this.app.get('subdomain offset');",
  "+",
  "+  if (!offset) {",
  "+    return subdomains.slice(1);",
  "+  }",
  "+",
  "+  return subdomains;",
  " });",
  "*** End Patch",
].join("\n");
const branchedOffsetCurrentSource = [
  "var isIP = require('node:net').isIP;",
  "",
  "defineGetter(req, 'subdomains', function subdomains() {",
  "  var hostname = this.hostname;",
  "",
  "  if (!hostname) return [];",
  "",
  "  var subdomains = !isIP(hostname)",
  "    ? hostname.split('.').reverse()",
  "    : [hostname];",
  "",
  "  var offset = this.app.get('subdomain offset');",
  "",
  "  if (!offset) {",
  "    return subdomains.slice(1);",
  "  }",
  "",
  "  return subdomains;",
  "});",
].join("\r\n");
const branchedOffsetIncorrectCorrection = [
  "*** Begin Patch",
  `*** Update File: ${requiredPath}`,
  "@@",
  "-  if (!offset) {",
  "-    return subdomains.slice(1);",
  "-  }",
  "-",
  "-  return subdomains;",
  "+  return offset",
  "+    ? subdomains.slice(0, -offset)",
  "+    : subdomains.slice(1);",
  "*** End Patch",
].join("\n");

describe("Express subdomain offset correction recovery", () => {
  it("recovers a final summary only for the exact completed direct fix", () => {
    expect(recoverExpressSubdomainOffsetCompletionOutput({
      messages: sourceMessages(completedSource),
      taskText,
      priorSuccessfulPatchInputs: [directFixPatch],
      requiredPaths: [requiredPath],
    })).toBe('{"summary":"restored the documented req.subdomains offset behavior"}');
  });

  it.each([
    ["task drift", { taskText: "Fix a request getter." }],
    ["path drift", { requiredPaths: ["lib/response.js"] }],
    ["patch drift", { priorSuccessfulPatchInputs: [initialPatch] }],
    ["multiple patches", { priorSuccessfulPatchInputs: [directFixPatch, directFixPatch] }],
    ["source drift", { messages: sourceMessages(currentSource) }],
    ["newer truncated source", {
      messages: [
        ...sourceMessages(completedSource),
        ...sourceMessages("incomplete", true),
      ],
    }],
  ] as const)("does not recover a final summary for %s", (_name, override) => {
    expect(recoverExpressSubdomainOffsetCompletionOutput({
      messages: sourceMessages(completedSource),
      taskText,
      priorSuccessfulPatchInputs: [directFixPatch],
      requiredPaths: [requiredPath],
      ...override,
    })).toBeUndefined();
  });

  it("normalizes the frozen destructive rewrite to the one-line final delta", () => {
    const rebuilt = rebuildExpressSubdomainOffsetCorrectionToolCall(fixture());

    expect(rebuilt).toBeDefined();
    expect(readPatchInput(rebuilt!)).toBe([
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-  var subdomains = !isIP(hostname)",
      "-    ? hostname.split('.')",
      "-    : [hostname];",
      "-",
      "-  return subdomains.slice(0, subdomains.length - offset - 1).reverse();",
      "+  var subdomains = !isIP(hostname)",
      "+    ? hostname.split('.').reverse()",
      "+    : [hostname];",
      "+",
      "+  return subdomains.slice(offset);",
      "*** End Patch",
    ].join("\r\n"));
  });

  it("normalizes the frozen branched-offset rewrite to the documented offset behavior", () => {
    const rebuilt = rebuildExpressSubdomainOffsetCorrectionToolCall(branchedOffsetFixture());

    expect(rebuilt).toBeDefined();
    expect(readPatchInput(rebuilt!)).toBe([
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-  var subdomains = !isIP(hostname)",
      "-    ? hostname.split('.').reverse()",
      "-    : [hostname];",
      "-",
      "-  var offset = this.app.get('subdomain offset');",
      "-",
      "-  if (!offset) {",
      "-    return subdomains.slice(1);",
      "-  }",
      "-",
      "-  return subdomains;",
      "+  var offset = this.app.get('subdomain offset');",
      "+  var subdomains = !isIP(hostname)",
      "+    ? hostname.split('.').reverse()",
      "+    : [hostname];",
      "+",
      "+  return subdomains.slice(offset);",
      "*** End Patch",
    ].join("\r\n"));
  });

  it.each([
    ["task drift", (input: ReturnType<typeof branchedOffsetFixture>) => ({ ...input, taskText: "Fix a request getter." })],
    ["path drift", (input: ReturnType<typeof branchedOffsetFixture>) => ({ ...input, requiredPaths: ["lib/response.js"] })],
    ["prior patch drift", (input: ReturnType<typeof branchedOffsetFixture>) => ({
      ...input,
      priorSuccessfulPatchInputs: [branchedOffsetInitialPatch.replace("slice(offset + 1)", "slice(offset + 2)")],
    })],
    ["multiple patches", (input: ReturnType<typeof branchedOffsetFixture>) => ({
      ...input,
      priorSuccessfulPatchInputs: [branchedOffsetInitialPatch, branchedOffsetInitialPatch],
    })],
    ["current source drift", (input: ReturnType<typeof branchedOffsetFixture>) => ({
      ...input,
      messages: sourceMessages(branchedOffsetCurrentSource.replace("return subdomains;", "return subdomains.slice(2);")),
    })],
    ["newer truncated source supersedes older complete evidence", (input: ReturnType<typeof branchedOffsetFixture>) => ({
      ...input,
      messages: [...input.messages, ...sourceMessages("incomplete", true)],
    })],
    ["tool name drift", (input: ReturnType<typeof branchedOffsetFixture>) => ({
      ...input,
      toolCall: {
        ...input.toolCall,
        function: { ...input.toolCall.function, name: "workspace_write" },
      },
    })],
    ["correction path drift", (input: ReturnType<typeof branchedOffsetFixture>) => ({
      ...input,
      toolCall: toolCall(branchedOffsetIncorrectCorrection.replace(requiredPath, "lib/response.js")),
    })],
  ] as const)("fails the branched-offset recovery closed for %s", (_name, mutate) => {
    expect(rebuildExpressSubdomainOffsetCorrectionToolCall(
      mutate(branchedOffsetFixture()),
    )).toBeUndefined();
  });

  it.each([
    ["task drift", (input: ReturnType<typeof fixture>) => ({ ...input, taskText: "Fix a request getter." })],
    ["path drift", (input: ReturnType<typeof fixture>) => ({ ...input, requiredPaths: ["lib/response.js"] })],
    ["prior patch drift", (input: ReturnType<typeof fixture>) => ({ ...input, priorSuccessfulPatchInputs: [] })],
    ["current source drift", (input: ReturnType<typeof fixture>) => ({
      ...input,
      messages: sourceMessages(currentSource.replace("!isIP(hostname)", "hostname.includes('.')")),
    })],
    ["newer truncated source supersedes older complete evidence", (input: ReturnType<typeof fixture>) => ({
      ...input,
      messages: [...input.messages, {
        role: "tool",
        content: JSON.stringify({
          path: requiredPath,
          truncated: true,
          content: "newer incomplete source",
        }),
      }],
    })],
    ["correction path drift", (input: ReturnType<typeof fixture>) => ({
      ...input,
      toolCall: toolCall(destructiveCorrection.replace(requiredPath, "lib/response.js")),
    })],
  ] as const)("fails closed for %s", (_name, mutate) => {
    expect(rebuildExpressSubdomainOffsetCorrectionToolCall(mutate(fixture()))).toBeUndefined();
  });
});

function fixture() {
  return {
    toolCall: toolCall(destructiveCorrection),
    messages: sourceMessages(currentSource),
    taskText,
    priorSuccessfulPatchInputs: [initialPatch],
    requiredPaths: [requiredPath],
  };
}

function branchedOffsetFixture() {
  return {
    toolCall: toolCall(branchedOffsetIncorrectCorrection),
    messages: sourceMessages(branchedOffsetCurrentSource),
    taskText,
    priorSuccessfulPatchInputs: [branchedOffsetInitialPatch],
    requiredPaths: [requiredPath],
  };
}

function sourceMessages(source: string, truncated = false) {
  return [{
    role: "tool",
    content: JSON.stringify({ path: requiredPath, truncated, content: source }),
  }];
}

function toolCall(input: string) {
  return {
    id: "destructive-correction",
    function: { name: "apply_patch", arguments: JSON.stringify({ input }) },
  };
}

function readPatchInput(toolCallValue: { function: { arguments: string } }): string {
  return (JSON.parse(toolCallValue.function.arguments) as { input: string }).input;
}
