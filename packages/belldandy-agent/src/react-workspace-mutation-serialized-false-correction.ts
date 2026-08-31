type SourceMessage = {
  role: string;
  content?: unknown;
};

const BROAD_SERIALIZED_FALSE_CONDITION = /^(?<indent>[ \t]*)}\s*else\s+if\s*\(value\s*===\s*false\s*&&\s*\(name\[0\]\s*==\s*'a'\s*\|\|\s*name\[0\]\s*==\s*'d'\)\s*&&\s*name\.indexOf\('-'\)\s*>\s*0\)\s*\{\s*$/;
const NULLISH_SERIALIZATION_CONDITION_SUFFIX = "} else if ((name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') || (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
const NULLISH_SERIALIZATION_STATEMENT = "dom.setAttribute(name, value == NULL || value === false ? String(value) : value);";
const REACHABLE_INLINE_SERIALIZED_FALSE_CONDITION_SUFFIX = "} else if (value != NULL && (value !== false || name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
const INVALID_INLINE_SERIALIZED_FALSE_REPLACEMENT_SUFFIX = "if (typeof value == 'function' || value == NULL || value === false && !(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
const BASELINE_SERIALIZED_FALSE_CONDITION_SUFFIX = "} else if (value != NULL && (value !== false || name[4] == '-')) {";
const EXISTING_ATTRIBUTE_STATEMENT = "dom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
const EXISTING_REMOVAL_STATEMENT = "dom.removeAttribute(name);";

type NullishSerializationBranch = {
  condition: string;
  conditionIndent: string;
  statement: string;
  statementIndent: string;
};

type ReachableInlineSerializedFalseBranch = {
  condition: string;
  conditionIndent: string;
  statement: string;
  followingElse: string;
  removalStatement: string;
};

export function rebuildSerializedFalseSiblingDoubleElseToolCall<
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
    || !requiresSerializedFalseTruthSet(input.taskText)) {
    return undefined;
  }
  const requiredPath = normalizePath(input.requiredPaths[0] ?? "");
  if (!requiredPath || !priorPatchAddedReachableInlineSerializedFalseCondition(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  )) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const branches = collectReachableInlineSerializedFalseBranches(source);
  if (branches.length !== 1) return undefined;
  const change = readSingleRequiredPathPatchChange(input.toolCall, requiredPath);
  if (!change) return undefined;
  const branch = branches[0]!;
  const wouldLeaveSiblingDoubleElse = change.removed.includes(branch.condition)
    && change.added.some((line) => (
      line.trimStart() === INVALID_INLINE_SERIALIZED_FALSE_REPLACEMENT_SUFFIX
    ))
    && change.added.includes(`${branch.conditionIndent}} else {`)
    && change.context.includes(branch.statement)
    && !change.removed.includes(branch.followingElse)
    && !change.removed.includes(branch.removalStatement);
  if (!wouldLeaveSiblingDoubleElse) return undefined;

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    `-${branch.condition}`,
    `+${branch.conditionIndent}${BASELINE_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
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

export function hasSerializedFalseNullishSerializationCurrentSource(
  messages: readonly SourceMessage[],
  taskText: string,
  priorSuccessfulPatchInputs: readonly string[],
  requiredPaths: readonly string[],
): boolean {
  if (requiredPaths.length !== 1 || !requiresSerializedFalseTruthSet(taskText)) {
    return false;
  }
  const requiredPath = normalizePath(requiredPaths[0] ?? "");
  if (!requiredPath || !priorPatchAddedNullishSerializationBranch(
    priorSuccessfulPatchInputs,
    requiredPath,
  )) {
    return false;
  }
  const source = readCompleteSource(messages, requiredPath);
  return source !== undefined && collectNullishSerializationBranches(source).length === 1;
}

export function rebuildSerializedFalseSemanticNarrowingToolCall<
  T extends { function: { name: string; arguments: string } },
>(input: {
  toolCall: T;
  messages: readonly SourceMessage[];
  taskText: string;
  priorSuccessfulPatchInputs: readonly string[];
  requiredPaths: readonly string[];
  correctionReason:
    | "smallest_change_requires_semantic_narrowing"
    | "serialized_false_nullish_serialization_requires_atomic_repair"
    | undefined;
}): T | undefined {
  if (input.toolCall.function.name !== "apply_patch"
    || input.requiredPaths.length !== 1
    || !requiresSerializedFalseSemanticNarrowing(input.taskText)) {
    return undefined;
  }

  const requiredPath = normalizePath(input.requiredPaths[0] ?? "");
  const priorPatchAddedBroadCondition = priorPatchAddedBroadSerializedFalseCondition(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  );
  const priorPatchAddedNullishBranch = priorPatchAddedNullishSerializationBranch(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  );
  if (!requiredPath
    || (input.correctionReason === "serialized_false_nullish_serialization_requires_atomic_repair"
      ? !priorPatchAddedNullishBranch
      : !priorPatchAddedBroadCondition)) return undefined;

  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const nullishBranches = collectNullishSerializationBranches(source);
  if (input.correctionReason === "serialized_false_nullish_serialization_requires_atomic_repair"
    && requiresSerializedFalseTruthSet(input.taskText)
    && priorPatchAddedNullishBranch
    && nullishBranches.length === 1) {
    const branch = nullishBranches[0]!;
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${input.requiredPaths[0]}`,
      "@@",
      `-${branch.condition}`,
      `+${branch.conditionIndent}} else if (value === false && name[4] == '-') {`,
      `-${branch.statement}`,
      `+${branch.statementIndent}dom.setAttribute(name, 'false');`,
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

function requiresSerializedFalseTruthSet(taskText: string): boolean {
  const normalizedTask = taskText.replace(/\s+/g, " ");
  return requiresSerializedFalseSemanticNarrowing(taskText)
    && (/\bremove\b.{0,80}\bordinary\b.{0,80}\bfalse\b/i.test(normalizedTask)
      || /\bfalse\b.{0,80}\bordinary\b.{0,80}\bremove\b/i.test(normalizedTask))
    && (/\bremove\b.{0,80}\bnull\b.{0,40}\bundefined\b/i.test(normalizedTask)
      || /\bnull\b.{0,40}\bundefined\b.{0,80}\bremove\b/i.test(normalizedTask));
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

function priorPatchAddedNullishSerializationBranch(
  patchInputs: readonly string[],
  requiredPath: string,
): boolean {
  return patchInputs.some((patchInput) => {
    let currentPath = "";
    let addedCondition = false;
    let addedStatement = false;
    for (const line of patchInput.split(/\r?\n/)) {
      if (line.startsWith("*** Update File: ")) {
        currentPath = normalizePath(line.slice("*** Update File: ".length));
        continue;
      }
      if (currentPath !== requiredPath || !line.startsWith("+")) continue;
      const addedLine = line.slice(1);
      addedCondition ||= addedLine.trimStart() === NULLISH_SERIALIZATION_CONDITION_SUFFIX;
      addedStatement ||= addedLine.trim() === NULLISH_SERIALIZATION_STATEMENT;
    }
    return addedCondition && addedStatement;
  });
}

function priorPatchAddedReachableInlineSerializedFalseCondition(
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
        && line.slice(1).trimStart() === REACHABLE_INLINE_SERIALIZED_FALSE_CONDITION_SUFFIX) {
        return true;
      }
    }
    return false;
  });
}

function collectNullishSerializationBranches(source: string): NullishSerializationBranch[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((condition, index) => {
    if (condition.trimStart() !== NULLISH_SERIALIZATION_CONDITION_SUFFIX) return [];
    const statement = lines[index + 1] ?? "";
    if (statement.trim() !== NULLISH_SERIALIZATION_STATEMENT) return [];
    return [{
      condition,
      conditionIndent: condition.slice(0, condition.length - condition.trimStart().length),
      statement,
      statementIndent: statement.slice(0, statement.length - statement.trimStart().length),
    }];
  });
}

function collectReachableInlineSerializedFalseBranches(
  source: string,
): ReachableInlineSerializedFalseBranch[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((condition, index) => {
    if (condition.trimStart() !== REACHABLE_INLINE_SERIALIZED_FALSE_CONDITION_SUFFIX) return [];
    const conditionIndent = condition.slice(0, condition.length - condition.trimStart().length);
    const statement = lines[index + 1] ?? "";
    const followingElse = lines[index + 2] ?? "";
    const removalStatement = lines[index + 3] ?? "";
    if (statement.trim() !== EXISTING_ATTRIBUTE_STATEMENT
      || followingElse !== `${conditionIndent}} else {`
      || removalStatement.trim() !== EXISTING_REMOVAL_STATEMENT) {
      return [];
    }
    return [{ condition, conditionIndent, statement, followingElse, removalStatement }];
  });
}

function readSingleRequiredPathPatchChange(
  toolCall: { function: { arguments: string } },
  requiredPath: string,
): { removed: string[]; added: string[]; context: string[] } | undefined {
  let patch: unknown;
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    patch = args.input;
  } catch {
    return undefined;
  }
  if (typeof patch !== "string") return undefined;
  let currentPath = "";
  let sectionCount = 0;
  const removed: string[] = [];
  const added: string[] = [];
  const context: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("*** Update File: ")) {
      currentPath = normalizePath(line.slice("*** Update File: ".length));
      sectionCount++;
      if (currentPath !== requiredPath) return undefined;
      continue;
    }
    if (!currentPath || line === "*** Begin Patch" || line === "*** End Patch" || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith(" ")) context.push(line.slice(1));
  }
  return sectionCount === 1 && removed.length > 0 && added.length > 0
    ? { removed, added, context }
    : undefined;
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
