type SourceMessage = {
  role: string;
  content?: unknown;
};

const BROAD_SERIALIZED_FALSE_CONDITION = /^(?<indent>[ \t]*)}\s*else\s+if\s*\(value\s*===\s*false\s*&&\s*\(name\[0\]\s*==\s*'a'\s*\|\|\s*name\[0\]\s*==\s*'d'\)\s*&&\s*name\.indexOf\('-'\)\s*>\s*0\)\s*\{\s*$/;

export function rebuildSerializedFalseSemanticNarrowingToolCall<
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
    || !requiresSerializedFalseSemanticNarrowing(input.taskText)) {
    return undefined;
  }

  const requiredPath = normalizePath(input.requiredPaths[0] ?? "");
  if (!requiredPath || !priorPatchAddedBroadSerializedFalseCondition(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  )) {
    return undefined;
  }

  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const matchingLines = source.split(/\r?\n/).flatMap((line) => (
    BROAD_SERIALIZED_FALSE_CONDITION.test(line) ? [line] : []
  ));
  if (matchingLines.length !== 1) return undefined;

  const broadCondition = matchingLines[0] ?? "";
  const match = BROAD_SERIALIZED_FALSE_CONDITION.exec(broadCondition);
  const indent = match?.groups?.indent;
  if (indent === undefined) return undefined;
  const narrowedCondition = `${indent}} else if (value === false && name[4] == '-') {`;
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    `-${broadCondition}`,
    `+${narrowedCondition}`,
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

function requiresSerializedFalseSemanticNarrowing(taskText: string): boolean {
  return /\b(?:smallest|minimal)\b.{0,32}\b(?:change|patch|diff|edit|modification)s?\b/i.test(taskText)
    && /\b(?:preserve|serialize|support|keep)\b.{0,64}\bfalse\b/i.test(taskText)
    && /\baria-\*/i.test(taskText)
    && /\bdata-\*/i.test(taskText);
}

function priorPatchAddedBroadSerializedFalseCondition(
  patchInputs: readonly string[],
  requiredPath: string,
): boolean {
  return patchInputs.some((patchInput) => {
    let currentPath = "";
    for (const line of patchInput.split(/\r?\n/)) {
      if (line.startsWith("*** Update File: ")) {
        currentPath = normalizePath(line.slice("*** Update File: ".length));
        continue;
      }
      if (currentPath === requiredPath
        && line.startsWith("+")
        && BROAD_SERIALIZED_FALSE_CONDITION.test(line.slice(1))) {
        return true;
      }
    }
    return false;
  });
}

function readCompleteSource(messages: readonly SourceMessage[], requiredPath: string): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "tool" || typeof message.content !== "string") continue;
    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>;
      if (typeof parsed.path !== "string"
        || normalizePath(parsed.path) !== requiredPath) continue;
      if (parsed.truncated !== false || typeof parsed.content !== "string") return undefined;
      return parsed.content;
    } catch {
      // Tool output is untrusted; malformed JSON cannot establish source identity.
    }
  }
  return undefined;
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}
