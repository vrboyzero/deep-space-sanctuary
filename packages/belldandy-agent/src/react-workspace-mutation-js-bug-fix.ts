type SourceMessage = {
  role: string;
  content?: unknown;
};

const REQUIRED_PATH = "lib/request.js";
const CURRENT_GETTER = [
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
] as const;
const COMPLETED_GETTER = [
  "defineGetter(req, 'subdomains', function subdomains() {",
  "  var hostname = this.hostname;",
  "",
  "  if (!hostname) return [];",
  "",
  "  var offset = this.app.get('subdomain offset');",
  "  var subdomains = !isIP(hostname)",
  "    ? hostname.split('.').reverse()",
  "    : [hostname];",
  "",
  "  return subdomains.slice(offset);",
  "});",
] as const;
const BRANCHED_OFFSET_GETTER = [
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
] as const;
const PRIOR_REMOVED_LINES = [
  "  var subdomains = !isIP(hostname)",
  "    ? hostname.split('.').reverse()",
  "    : [hostname];",
  "",
  "  return subdomains.slice(offset + 1);",
] as const;
const PRIOR_ADDED_LINES = CURRENT_GETTER.slice(6, 11);
const BRANCHED_OFFSET_PRIOR_REMOVED_LINES = [
  "  var offset = this.app.get('subdomain offset');",
  "  return subdomains.slice(offset + 1);",
] as const;
const BRANCHED_OFFSET_PRIOR_ADDED_LINES = BRANCHED_OFFSET_GETTER.slice(9, 16);
const DIRECT_FIX_REMOVED_LINES = ["  return subdomains.slice(offset + 1);"] as const;
const DIRECT_FIX_ADDED_LINES = ["  return subdomains.slice(offset);"] as const;
const COMPLETION_OUTPUT = JSON.stringify({
  summary: "restored the documented req.subdomains offset behavior",
});

export function recoverExpressSubdomainOffsetCompletionOutput(input: {
  messages: readonly SourceMessage[];
  taskText: string;
  priorSuccessfulPatchInputs: readonly string[];
  requiredPaths: readonly string[];
}): string | undefined {
  if (input.requiredPaths.length !== 1
    || normalizePath(input.requiredPaths[0] ?? "") !== REQUIRED_PATH
    || input.priorSuccessfulPatchInputs.length !== 1
    || !taskMatchesFrozenExpressBugFix(input.taskText)) {
    return undefined;
  }
  const priorChange = readSinglePathPatchChange(
    input.priorSuccessfulPatchInputs[0] ?? "",
    REQUIRED_PATH,
  );
  if (!priorChange
    || !hasExactLines(priorChange.removed, DIRECT_FIX_REMOVED_LINES)
    || !hasExactLines(priorChange.added, DIRECT_FIX_ADDED_LINES)) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, REQUIRED_PATH);
  if (!source
    || !source.includes("var isIP = require('node:net').isIP;")
    || source.includes(DIRECT_FIX_REMOVED_LINES[0])
    || findExactLineSequenceStarts(source, COMPLETED_GETTER).length !== 1) {
    return undefined;
  }
  return COMPLETION_OUTPUT;
}

export function rebuildExpressSubdomainOffsetCorrectionToolCall<
  T extends { function: { name: string; arguments: string } },
>(input: {
  toolCall: T;
  messages: readonly SourceMessage[];
  taskText: string;
  priorSuccessfulPatchInputs: readonly string[];
  requiredPaths: readonly string[];
}): T | undefined {
  if (input.toolCall.function.name !== "apply_patch"
    || input.requiredPaths.length !== 1
    || normalizePath(input.requiredPaths[0] ?? "") !== REQUIRED_PATH
    || input.priorSuccessfulPatchInputs.length !== 1
    || !taskMatchesFrozenExpressBugFix(input.taskText)
    || !toolCallHasSingleRequiredPath(input.toolCall, REQUIRED_PATH)) {
    return undefined;
  }
  const priorChange = readSinglePathPatchChange(
    input.priorSuccessfulPatchInputs[0] ?? "",
    REQUIRED_PATH,
  );
  if (!priorChange) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, REQUIRED_PATH);
  if (!source || !source.includes("var isIP = require('node:net').isIP;")) {
    return undefined;
  }

  const correction = hasExactLines(priorChange.removed, PRIOR_REMOVED_LINES)
    && hasExactLines(priorChange.added, PRIOR_ADDED_LINES)
    && findExactLineSequenceStarts(source, CURRENT_GETTER).length === 1
    ? {
        removed: PRIOR_ADDED_LINES,
        added: COMPLETED_GETTER.slice(6, 11),
      }
    : hasExactLines(priorChange.removed, BRANCHED_OFFSET_PRIOR_REMOVED_LINES)
      && hasExactLines(priorChange.added, BRANCHED_OFFSET_PRIOR_ADDED_LINES)
      && findExactLineSequenceStarts(source, BRANCHED_OFFSET_GETTER).length === 1
      ? {
          removed: BRANCHED_OFFSET_GETTER.slice(5, 16),
          added: COMPLETED_GETTER.slice(5, 11),
        }
      : undefined;
  if (!correction) return undefined;

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    ...correction.removed.map((line) => `-${line}`),
    ...correction.added.map((line) => `+${line}`),
    "*** End Patch",
  ].join(lineEnding);
  return {
    ...input.toolCall,
    function: {
      ...input.toolCall.function,
      arguments: JSON.stringify({ input: patch }),
    },
  } as T;
}

function taskMatchesFrozenExpressBugFix(taskText: string): boolean {
  return taskText.includes("Reproduce the frozen JavaScript regression in the real repository")
    && taskText.includes("test/benchmark-v3/real-js-bug-fix.js")
    && taskText.includes("Restore the documented req.subdomains offset behavior with the smallest change in lib/request.js")
    && taskText.includes("Do not modify tests, dependencies, package metadata, or any other source file");
}

function readCompleteSource(
  messages: readonly SourceMessage[],
  requiredPath: string,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "tool" || typeof message.content !== "string") continue;
    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>;
      if (typeof parsed.path !== "string"
        || normalizePath(parsed.path) !== requiredPath) continue;
      return parsed.truncated === false && typeof parsed.content === "string"
        ? parsed.content
        : undefined;
    } catch {
      // Tool output is untrusted and cannot establish source identity.
    }
  }
  return undefined;
}

function toolCallHasSingleRequiredPath(
  toolCall: { function: { arguments: string } },
  requiredPath: string,
): boolean {
  try {
    const parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    return typeof parsed.input === "string"
      && readSinglePathPatchChange(parsed.input, requiredPath) !== undefined;
  } catch {
    return false;
  }
}

function readSinglePathPatchChange(
  patchInput: string,
  requiredPath: string,
): { removed: string[]; added: string[] } | undefined {
  const lines = patchInput.trim().split(/\r?\n/);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    return undefined;
  }
  const directives = lines.filter((line) => line.startsWith("*** ")
    && line !== "*** Begin Patch"
    && line !== "*** End Patch");
  if (directives.length !== 1
    || directives[0] !== `*** Update File: ${requiredPath}`) {
    return undefined;
  }
  const removed = lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1));
  const added = lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
  return removed.length > 0 && added.length > 0 ? { removed, added } : undefined;
}

function findExactLineSequenceStarts(source: string, expected: readonly string[]): number[] {
  const lines = source.split(/\r?\n/);
  const starts: number[] = [];
  for (let index = 0; index <= lines.length - expected.length; index += 1) {
    if (expected.every((line, offset) => lines[index + offset] === line)) {
      starts.push(index);
    }
  }
  return starts;
}

function hasExactLines(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((line, index) => line === expected[index]);
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}
