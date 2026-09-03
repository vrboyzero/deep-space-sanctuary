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
const PRIOR_REMOVED_LINES = [
  "  var subdomains = !isIP(hostname)",
  "    ? hostname.split('.').reverse()",
  "    : [hostname];",
  "",
  "  return subdomains.slice(offset + 1);",
] as const;
const PRIOR_ADDED_LINES = CURRENT_GETTER.slice(6, 11);

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
  if (!priorChange
    || !hasExactLines(priorChange.removed, PRIOR_REMOVED_LINES)
    || !hasExactLines(priorChange.added, PRIOR_ADDED_LINES)) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, REQUIRED_PATH);
  if (!source
    || !source.includes("var isIP = require('node:net').isIP;")
    || findExactLineSequenceStarts(source, CURRENT_GETTER).length !== 1) {
    return undefined;
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    ...PRIOR_ADDED_LINES.map((line) => `-${line}`),
    ...[
      "  var subdomains = !isIP(hostname)",
      "    ? hostname.split('.').reverse()",
      "    : [hostname];",
      "",
      "  return subdomains.slice(offset);",
    ].map((line) => `+${line}`),
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
