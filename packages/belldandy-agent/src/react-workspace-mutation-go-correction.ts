type WorkspaceMutationToolCall = {
  function: {
    name: string;
    arguments: string;
  };
};

export function isRegressiveCommandNameCorrection(input: {
  toolCall: WorkspaceMutationToolCall;
  priorSuccessfulPatchInputs: readonly string[];
  taskText: string;
  requiredChangedPaths: readonly string[];
}): boolean {
  if (!isFrozenCommandNameTask(input.taskText)
    || input.requiredChangedPaths.length !== 1
    || normalizePath(input.requiredChangedPaths[0] ?? "") !== "command.go"
    || input.toolCall.function.name !== "apply_patch"
    || !input.priorSuccessfulPatchInputs.some(hasFrozenIndexFix)) {
    return false;
  }

  const correctionPatch = readPatchInput(input.toolCall.function.arguments);
  return correctionPatch !== undefined
    && targetsCommandGo(correctionPatch)
    && hasChangedLine(correctionPatch, "-\ti := strings.Index(name, \" \")")
    && !hasChangedLine(correctionPatch, "+\ti := strings.Index(name, \" \")");
}

function isFrozenCommandNameTask(taskText: string): boolean {
  return taskText.includes("Reproduce the frozen Go regression")
    && /\bmake the smallest correction\b/i.test(taskText)
    && taskText.includes("GOPROXY disabled");
}

function hasFrozenIndexFix(patchInput: string): boolean {
  return targetsCommandGo(patchInput)
    && hasChangedLine(patchInput, "-\ti := strings.LastIndex(name, \" \")")
    && hasChangedLine(patchInput, "+\ti := strings.Index(name, \" \")");
}

function targetsCommandGo(patchInput: string): boolean {
  return patchInput.split(/\r?\n/).some((line) => (
    line === "*** Update File: command.go"
  ));
}

function hasChangedLine(patchInput: string, expectedLine: string): boolean {
  return patchInput.split(/\r?\n/).includes(expectedLine);
}

function readPatchInput(argumentsText: string): string | undefined {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return isRecord(parsed) && typeof parsed.input === "string"
      ? parsed.input
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
