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
const PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX = "} else if (value != NULL && value !== false) {";
const MULTILINE_SERIALIZED_FALSE_CONDITION_START_SUFFIX = "} else if (";
const MULTILINE_SERIALIZED_FALSE_GUARD_SUFFIX = "value != NULL &&";
const FROZEN_MULTILINE_SERIALIZED_FALSE_PREDICATE_SUFFIX = "(value !== false || (name[0] == 'a' && name[0] == 'a'))";
const BROAD_FIRST_CHARACTER_SERIALIZED_FALSE_PREDICATE_SUFFIX = "(value !== false || name[0] == 'a' || name[0] == 'd')";
const MULTILINE_SERIALIZED_FALSE_CONDITION_END_SUFFIX = ") {";
const NESTED_SERIALIZED_FALSE_REMOVAL_CONDITION_SUFFIX = "} else if (value == NULL || value === false) {";
const NESTED_SERIALIZED_FALSE_PREFIX_CONDITION_SUFFIX = "if (name.slice(0, 5) == 'aria-' || name.slice(0, 5) == 'data-') {";
const NESTED_UNREACHABLE_SERIALIZED_FALSE_CONDITION_SUFFIX = "if (value === false && (name.slice(0, 5) == 'aria-' || name.slice(0, 5) == 'data-')) {";
const NESTED_SERIALIZED_FALSE_STATEMENT = "dom.setAttribute(name, String(value));";
const INITIAL_NARROW_PREFIX_SERIALIZED_FALSE_CONDITION_SUFFIX = "} else if (value === false && (name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a')) {";
const NARROW_AR_PREFIX_SERIALIZED_FALSE_CONDITION_SUFFIX = "} else if (value === false && (name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')) {";
const SERIALIZED_FALSE_LITERAL_STATEMENT = "dom.setAttribute(name, 'false');";
const FUNCTION_ATTRIBUTE_GUARD_SUFFIX = "if (typeof value == 'function') {";
const FUNCTION_ATTRIBUTE_COMMENT = "// never serialize functions as attribute values";
const EXISTING_ATTRIBUTE_STATEMENT = "dom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
const EXISTING_REMOVAL_STATEMENT = "dom.removeAttribute(name);";
const SERIALIZED_FALSE_COMMENT_LINES = [
  "// aria- and data- attributes have no boolean representation.",
  "// A `false` value is different from the attribute not being",
  "// present, so we can't remove it. For non-boolean aria",
  "// attributes we could treat false as a removal, but the",
  "// amount of exceptions would cost too many bytes. On top of",
  "// that other frameworks generally stringify `false`.",
] as const;
const ARIA_SERIALIZED_FALSE_CONDITION_SUFFIX = "if (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {";
const DATA_SERIALIZED_FALSE_CONDITION_SUFFIX = "} else if (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {";
const NON_NULL_ATTRIBUTE_CONDITION_SUFFIX = "} else if (value != NULL) {";
const PLACEHOLDER_NULLISH_CONDITION_SUFFIX = "if (value == NULL && name in dom) { ... }";

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

type FrozenMultilineSerializedFalseBranch = {
  conditionStart: string;
  guard: string;
  predicate: string;
  conditionEnd: string;
  conditionIndent: string;
  statement: string;
  followingElse: string;
  removalStatement: string;
};

type NestedSerializedFalseBranch = {
  removalCondition: string;
  removalStatement: string;
  outerElse: string;
  prefixCondition: string;
  serializationStatement: string;
  innerElse: string;
  fallbackStatement: string;
  innerEnd: string;
  outerEnd: string;
  conditionIndent: string;
  statementIndent: string;
};

type NarrowPrefixSerializedFalseBranch = {
  primaryCondition: string;
  primaryStatement: string;
  prefixCondition: string;
  serializationStatement: string;
  followingElse: string;
  removalStatement: string;
  branchEnd: string;
  conditionIndent: string;
  statementIndent: string;
};

type InitialSerializedFalseBranch = {
  functionGuard: string;
  comment: string;
  condition: string;
  statement: string;
  followingElse: string;
  removalStatement: string;
  branchEnd: string;
  conditionIndent: string;
};

type PostWriteSiblingSerializedFalseBranch = {
  commentLines: string[];
  ownedBranchLines: string[];
  fallbackComment: string;
  fallbackCondition: string;
  fallbackStatement: string;
  conditionIndent: string;
};

export function rebuildSerializedFalseInitialNoOpToolCall<
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
    || input.priorSuccessfulPatchInputs.length !== 0
    || !requiresSerializedFalseTruthSet(input.taskText)) {
    return undefined;
  }
  const requiredPath = normalizePath(input.requiredPaths[0] ?? "");
  if (!requiredPath) return undefined;
  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const branches = collectInitialSerializedFalseBranches(source);
  if (branches.length !== 1) return undefined;
  const branch = branches[0]!;
  const change = readSingleRequiredPathPatchChange(input.toolCall, requiredPath);
  if (!change
    || change.removed.length !== 2
    || change.added.length !== 2
    || change.removed[0] !== branch.functionGuard
    || change.added[0] !== branch.functionGuard
    || change.removed[1] !== branch.condition
    || change.added[1] !== branch.condition
    || !toolCallHasContiguousRequiredPathLines(input.toolCall, requiredPath, [
      `-${branch.functionGuard}`,
      `+${branch.functionGuard}`,
      ` ${branch.comment}`,
      `-${branch.condition}`,
      `+${branch.condition}`,
      ` ${branch.statement}`,
      ` ${branch.followingElse}`,
      ` ${branch.removalStatement}`,
    ])) {
    return undefined;
  }

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

export function rebuildSerializedFalsePlaceholderCorrectionToolCall<
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
    || input.priorSuccessfulPatchInputs.length !== 1
    || !requiresSerializedFalseTruthSet(input.taskText)) {
    return undefined;
  }
  const requiredPath = normalizePath(input.requiredPaths[0] ?? "");
  if (!requiredPath || !priorPatchAddedPostWriteSiblingSerializedFalseBranch(
    input.priorSuccessfulPatchInputs[0]!,
    requiredPath,
  )) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const branches = collectPostWriteSiblingSerializedFalseBranches(source);
  if (branches.length !== 1) return undefined;
  const branch = branches[0]!;
  const change = readSingleRequiredPathPatchChange(input.toolCall, requiredPath);
  const placeholderCondition = `${branch.conditionIndent}${PLACEHOLDER_NULLISH_CONDITION_SUFFIX}`;
  if (!change
    || change.removed.length !== SERIALIZED_FALSE_COMMENT_LINES.length
    || change.added.length !== 1
    || !change.removed.every((line, index) => line === branch.commentLines[index])
    || change.added[0] !== placeholderCondition
    || !toolCallHasContiguousRequiredPathLines(input.toolCall, requiredPath, [
      ...branch.commentLines.map((line) => `-${line}`),
      `+${placeholderCondition}`,
    ])) {
    return undefined;
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    ...branch.ownedBranchLines.map((line) => `-${line}`),
    `+${branch.conditionIndent}${FUNCTION_ATTRIBUTE_GUARD_SUFFIX}`,
    ` ${branch.fallbackComment}`,
    `-${branch.fallbackCondition}`,
    `+${branch.conditionIndent}${BASELINE_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
    ` ${branch.fallbackStatement}`,
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

export function rebuildSerializedFalseNarrowArPrefixToolCall<
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
  if (!requiredPath || !priorPatchAddedNarrowPrefixSerializedFalseBranch(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  )) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const branches = collectNarrowPrefixSerializedFalseBranches(source);
  if (branches.length !== 1) return undefined;
  const change = readSingleRequiredPathPatchChange(input.toolCall, requiredPath);
  if (!change || change.removed.length !== 1 || change.added.length !== 1) return undefined;
  const branch = branches[0]!;
  const narrowedCondition = `${branch.conditionIndent}${NARROW_AR_PREFIX_SERIALIZED_FALSE_CONDITION_SUFFIX}`;
  if (change.removed[0] !== branch.prefixCondition
    || change.added[0] !== narrowedCondition
    || !toolCallHasContiguousRequiredPathLines(input.toolCall, requiredPath, [
      `-${branch.prefixCondition}`,
      `+${narrowedCondition}`,
    ])) {
    return undefined;
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    `-${branch.primaryCondition}`,
    `-${branch.primaryStatement}`,
    `-${branch.prefixCondition}`,
    `-${branch.serializationStatement}`,
    `+${branch.conditionIndent}${BASELINE_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
    `+${branch.statementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`,
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

export function rebuildSerializedFalseNestedUnreachableToolCall<
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
  if (!requiredPath || !priorPatchAddedNestedSerializedFalseBranch(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  )) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const branches = collectNestedSerializedFalseBranches(source);
  if (branches.length !== 1) return undefined;
  const change = readSingleRequiredPathPatchChange(input.toolCall, requiredPath);
  if (!change || change.removed.length !== 1 || change.added.length !== 1) return undefined;
  const branch = branches[0]!;
  const unreachableCondition = `${branch.statementIndent}${NESTED_UNREACHABLE_SERIALIZED_FALSE_CONDITION_SUFFIX}`;
  const isFrozenUnreachableCorrection = change.removed[0] === branch.prefixCondition
    && change.added[0] === unreachableCondition
    && toolCallHasContiguousRequiredPathLines(input.toolCall, requiredPath, [
      ` ${branch.removalCondition}`,
      ` ${branch.removalStatement}`,
      ` ${branch.outerElse}`,
      `-${branch.prefixCondition}`,
      `+${unreachableCondition}`,
      ` ${branch.serializationStatement}`,
    ]);
  if (!isFrozenUnreachableCorrection) return undefined;

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    `-${branch.removalCondition}`,
    `-${branch.removalStatement}`,
    `-${branch.outerElse}`,
    `-${branch.prefixCondition}`,
    `-${branch.serializationStatement}`,
    `-${branch.innerElse}`,
    `-${branch.fallbackStatement}`,
    `-${branch.innerEnd}`,
    `+${branch.conditionIndent}${BASELINE_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
    `+${branch.statementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`,
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

export function rebuildSerializedFalseBroadFirstCharacterToolCall<
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
  if (!requiredPath || !priorPatchAddedFrozenMultilineSerializedFalseCondition(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  )) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const branches = collectFrozenMultilineSerializedFalseBranches(source);
  if (branches.length !== 1) return undefined;
  const change = readSingleRequiredPathPatchChange(input.toolCall, requiredPath);
  if (!change || change.removed.length !== 1 || change.added.length !== 1) return undefined;
  const branch = branches[0]!;
  const isFrozenBroadeningCorrection = change.removed[0] === branch.predicate
    && change.added[0]?.trimStart() === BROAD_FIRST_CHARACTER_SERIALIZED_FALSE_PREDICATE_SUFFIX
    && toolCallHasContiguousRequiredPathLines(input.toolCall, requiredPath, [
      ` ${branch.conditionStart}`,
      ` ${branch.guard}`,
      `-${branch.predicate}`,
      `+${branch.predicate.slice(0, branch.predicate.length - branch.predicate.trimStart().length)}${BROAD_FIRST_CHARACTER_SERIALIZED_FALSE_PREDICATE_SUFFIX}`,
      ` ${branch.conditionEnd}`,
    ]);
  if (!isFrozenBroadeningCorrection) return undefined;

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${input.requiredPaths[0]}`,
    "@@",
    `-${branch.conditionStart}`,
    `-${branch.guard}`,
    `-${branch.predicate}`,
    `-${branch.conditionEnd}`,
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

function priorPatchAddedFrozenMultilineSerializedFalseCondition(
  patchInputs: readonly string[],
  requiredPath: string,
): boolean {
  return patchInputs.some((patchInput) => patchHasContiguousRequiredPathLines(
    patchInput,
    requiredPath,
    [
      `-${PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
      `+${MULTILINE_SERIALIZED_FALSE_CONDITION_START_SUFFIX}`,
      `+${MULTILINE_SERIALIZED_FALSE_GUARD_SUFFIX}`,
      `+${FROZEN_MULTILINE_SERIALIZED_FALSE_PREDICATE_SUFFIX}`,
      `+${MULTILINE_SERIALIZED_FALSE_CONDITION_END_SUFFIX}`,
    ],
    true,
  ));
}

function priorPatchAddedNestedSerializedFalseBranch(
  patchInputs: readonly string[],
  requiredPath: string,
): boolean {
  return patchInputs.some((patchInput) => patchHasContiguousRequiredPathLines(
    patchInput,
    requiredPath,
    [
      `-${PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
      `-${EXISTING_ATTRIBUTE_STATEMENT}`,
      `+${NESTED_SERIALIZED_FALSE_REMOVAL_CONDITION_SUFFIX}`,
      `+${EXISTING_REMOVAL_STATEMENT}`,
      ` \t\t} else {`,
      `-${EXISTING_REMOVAL_STATEMENT}`,
      `+${NESTED_SERIALIZED_FALSE_PREFIX_CONDITION_SUFFIX}`,
      `+${NESTED_SERIALIZED_FALSE_STATEMENT}`,
      `+} else {`,
      `+${EXISTING_ATTRIBUTE_STATEMENT}`,
      `+}`,
      ` \t\t}`,
    ],
    true,
  ));
}

function priorPatchAddedNarrowPrefixSerializedFalseBranch(
  patchInputs: readonly string[],
  requiredPath: string,
): boolean {
  return patchInputs.some((patchInput) => patchHasContiguousRequiredPathLines(
    patchInput,
    requiredPath,
    [
      "-if (typeof value == 'function') {",
      "-// never serialize functions as attribute values",
      `-${PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
      `-${EXISTING_ATTRIBUTE_STATEMENT}`,
      "-} else {",
      `-${EXISTING_REMOVAL_STATEMENT}`,
      "-}",
      "+if (typeof value == 'function') {",
      "+// never serialize functions as attribute values",
      `+${PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
      `+${EXISTING_ATTRIBUTE_STATEMENT}`,
      `+${INITIAL_NARROW_PREFIX_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
      `+${SERIALIZED_FALSE_LITERAL_STATEMENT}`,
      "+} else {",
      `+${EXISTING_REMOVAL_STATEMENT}`,
      "+}",
    ],
    true,
  ));
}

function priorPatchAddedPostWriteSiblingSerializedFalseBranch(
  patchInput: string,
  requiredPath: string,
): boolean {
  const patchFileDirectives = patchInput.split(/\r?\n/).filter((line) => (
    /^\*\*\* (?:Update|Add|Delete|Move) File: /.test(line)
  ));
  return patchFileDirectives.length === 1
    && patchFileDirectives[0] === `*** Update File: ${requiredPath}`
    && patchHasContiguousRequiredPathLines(
      patchInput,
      requiredPath,
      [
        `-${FUNCTION_ATTRIBUTE_GUARD_SUFFIX}`,
        ...SERIALIZED_FALSE_COMMENT_LINES.map((line) => `+${line}`),
        `+${ARIA_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
        `+${FUNCTION_ATTRIBUTE_GUARD_SUFFIX}`,
        `+${FUNCTION_ATTRIBUTE_COMMENT}`,
        `+${NON_NULL_ATTRIBUTE_CONDITION_SUFFIX}`,
        `+${EXISTING_ATTRIBUTE_STATEMENT}`,
        "+} else {",
        `+${EXISTING_REMOVAL_STATEMENT}`,
        "+}",
        `+${DATA_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
        `+${FUNCTION_ATTRIBUTE_GUARD_SUFFIX}`,
        `+${FUNCTION_ATTRIBUTE_COMMENT}`,
        `+${NON_NULL_ATTRIBUTE_CONDITION_SUFFIX}`,
        `+${EXISTING_ATTRIBUTE_STATEMENT}`,
        "+} else {",
        `+${EXISTING_REMOVAL_STATEMENT}`,
        "+}",
        "+} else if (typeof value == 'function') {",
      ],
      true,
    );
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

function collectFrozenMultilineSerializedFalseBranches(
  source: string,
): FrozenMultilineSerializedFalseBranch[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((conditionStart, index) => {
    if (conditionStart.trimStart() !== MULTILINE_SERIALIZED_FALSE_CONDITION_START_SUFFIX) return [];
    const conditionIndent = conditionStart.slice(
      0,
      conditionStart.length - conditionStart.trimStart().length,
    );
    const guard = lines[index + 1] ?? "";
    const predicate = lines[index + 2] ?? "";
    const conditionEnd = lines[index + 3] ?? "";
    const statement = lines[index + 4] ?? "";
    const followingElse = lines[index + 5] ?? "";
    const removalStatement = lines[index + 6] ?? "";
    if (guard.trimStart() !== MULTILINE_SERIALIZED_FALSE_GUARD_SUFFIX
      || predicate.trimStart() !== FROZEN_MULTILINE_SERIALIZED_FALSE_PREDICATE_SUFFIX
      || conditionEnd.trimStart() !== MULTILINE_SERIALIZED_FALSE_CONDITION_END_SUFFIX
      || statement.trim() !== EXISTING_ATTRIBUTE_STATEMENT
      || followingElse !== `${conditionIndent}} else {`
      || removalStatement.trim() !== EXISTING_REMOVAL_STATEMENT) {
      return [];
    }
    return [{
      conditionStart,
      guard,
      predicate,
      conditionEnd,
      conditionIndent,
      statement,
      followingElse,
      removalStatement,
    }];
  });
}

function collectNestedSerializedFalseBranches(source: string): NestedSerializedFalseBranch[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((removalCondition, index) => {
    if (removalCondition.trimStart() !== NESTED_SERIALIZED_FALSE_REMOVAL_CONDITION_SUFFIX) {
      return [];
    }
    const conditionIndent = removalCondition.slice(
      0,
      removalCondition.length - removalCondition.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    const removalStatement = lines[index + 1] ?? "";
    const outerElse = lines[index + 2] ?? "";
    const prefixCondition = lines[index + 3] ?? "";
    const serializationStatement = lines[index + 4] ?? "";
    const innerElse = lines[index + 5] ?? "";
    const fallbackStatement = lines[index + 6] ?? "";
    const innerEnd = lines[index + 7] ?? "";
    const outerEnd = lines[index + 8] ?? "";
    if (removalStatement !== `${statementIndent}${EXISTING_REMOVAL_STATEMENT}`
      || outerElse !== `${conditionIndent}} else {`
      || prefixCondition !== `${statementIndent}${NESTED_SERIALIZED_FALSE_PREFIX_CONDITION_SUFFIX}`
      || serializationStatement !== `${statementIndent}\t${NESTED_SERIALIZED_FALSE_STATEMENT}`
      || innerElse !== `${statementIndent}} else {`
      || fallbackStatement !== `${statementIndent}\t${EXISTING_ATTRIBUTE_STATEMENT}`
      || innerEnd !== `${statementIndent}}`
      || outerEnd !== `${conditionIndent}}`) {
      return [];
    }
    return [{
      removalCondition,
      removalStatement,
      outerElse,
      prefixCondition,
      serializationStatement,
      innerElse,
      fallbackStatement,
      innerEnd,
      outerEnd,
      conditionIndent,
      statementIndent,
    }];
  });
}

function collectNarrowPrefixSerializedFalseBranches(
  source: string,
): NarrowPrefixSerializedFalseBranch[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((primaryCondition, index) => {
    if (primaryCondition.trimStart() !== PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX) return [];
    const conditionIndent = primaryCondition.slice(
      0,
      primaryCondition.length - primaryCondition.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    const primaryStatement = lines[index + 1] ?? "";
    const prefixCondition = lines[index + 2] ?? "";
    const serializationStatement = lines[index + 3] ?? "";
    const followingElse = lines[index + 4] ?? "";
    const removalStatement = lines[index + 5] ?? "";
    const branchEnd = lines[index + 6] ?? "";
    if (primaryStatement !== `${statementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`
      || prefixCondition !== `${conditionIndent}${INITIAL_NARROW_PREFIX_SERIALIZED_FALSE_CONDITION_SUFFIX}`
      || serializationStatement !== `${statementIndent}${SERIALIZED_FALSE_LITERAL_STATEMENT}`
      || followingElse !== `${conditionIndent}} else {`
      || removalStatement !== `${statementIndent}${EXISTING_REMOVAL_STATEMENT}`
      || branchEnd !== `${conditionIndent}}`) {
      return [];
    }
    return [{
      primaryCondition,
      primaryStatement,
      prefixCondition,
      serializationStatement,
      followingElse,
      removalStatement,
      branchEnd,
      conditionIndent,
      statementIndent,
    }];
  });
}

function collectInitialSerializedFalseBranches(source: string): InitialSerializedFalseBranch[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((functionGuard, index) => {
    if (functionGuard.trimStart() !== FUNCTION_ATTRIBUTE_GUARD_SUFFIX) return [];
    const conditionIndent = functionGuard.slice(
      0,
      functionGuard.length - functionGuard.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    const comment = lines[index + 1] ?? "";
    const condition = lines[index + 2] ?? "";
    const statement = lines[index + 3] ?? "";
    const followingElse = lines[index + 4] ?? "";
    const removalStatement = lines[index + 5] ?? "";
    const branchEnd = lines[index + 6] ?? "";
    if (comment !== `${statementIndent}${FUNCTION_ATTRIBUTE_COMMENT}`
      || condition !== `${conditionIndent}${PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX}`
      || statement !== `${statementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`
      || followingElse !== `${conditionIndent}} else {`
      || removalStatement !== `${statementIndent}${EXISTING_REMOVAL_STATEMENT}`
      || branchEnd !== `${conditionIndent}}`) {
      return [];
    }
    return [{
      functionGuard,
      comment,
      condition,
      statement,
      followingElse,
      removalStatement,
      branchEnd,
      conditionIndent,
    }];
  });
}

function collectPostWriteSiblingSerializedFalseBranches(
  source: string,
): PostWriteSiblingSerializedFalseBranch[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((firstComment, index) => {
    const conditionIndent = firstComment.slice(
      0,
      firstComment.length - firstComment.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    const nestedStatementIndent = `${statementIndent}\t`;
    const commentLines = SERIALIZED_FALSE_COMMENT_LINES.map((line, offset) => (
      lines[index + offset] ?? ""
    ));
    if (!commentLines.every((line, offset) => (
      line === `${conditionIndent}${SERIALIZED_FALSE_COMMENT_LINES[offset]}`
    ))) return [];
    const branchStart = index + SERIALIZED_FALSE_COMMENT_LINES.length;
    const ownedBranchLines = lines.slice(branchStart, branchStart + 17);
    const expectedOwnedBranchLines = [
      `${conditionIndent}${ARIA_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
      `${statementIndent}${FUNCTION_ATTRIBUTE_GUARD_SUFFIX}`,
      `${nestedStatementIndent}${FUNCTION_ATTRIBUTE_COMMENT}`,
      `${statementIndent}${NON_NULL_ATTRIBUTE_CONDITION_SUFFIX}`,
      `${nestedStatementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`,
      `${statementIndent}} else {`,
      `${nestedStatementIndent}${EXISTING_REMOVAL_STATEMENT}`,
      `${statementIndent}}`,
      `${conditionIndent}${DATA_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
      `${statementIndent}${FUNCTION_ATTRIBUTE_GUARD_SUFFIX}`,
      `${nestedStatementIndent}${FUNCTION_ATTRIBUTE_COMMENT}`,
      `${statementIndent}${NON_NULL_ATTRIBUTE_CONDITION_SUFFIX}`,
      `${nestedStatementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`,
      `${statementIndent}} else {`,
      `${nestedStatementIndent}${EXISTING_REMOVAL_STATEMENT}`,
      `${statementIndent}}`,
      `${conditionIndent}} else if (typeof value == 'function') {`,
    ];
    if (!ownedBranchLines.every((line, offset) => line === expectedOwnedBranchLines[offset])) {
      return [];
    }
    const fallbackComment = lines[branchStart + 17] ?? "";
    const fallbackCondition = lines[branchStart + 18] ?? "";
    const fallbackStatement = lines[branchStart + 19] ?? "";
    const fallbackElse = lines[branchStart + 20] ?? "";
    const fallbackRemoval = lines[branchStart + 21] ?? "";
    const fallbackEnd = lines[branchStart + 22] ?? "";
    if (fallbackComment !== `${statementIndent}${FUNCTION_ATTRIBUTE_COMMENT}`
      || fallbackCondition !== `${conditionIndent}${PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX}`
      || fallbackStatement !== `${statementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`
      || fallbackElse !== `${conditionIndent}} else {`
      || fallbackRemoval !== `${statementIndent}${EXISTING_REMOVAL_STATEMENT}`
      || fallbackEnd !== `${conditionIndent}}`) {
      return [];
    }
    return [{
      commentLines,
      ownedBranchLines,
      fallbackComment,
      fallbackCondition,
      fallbackStatement,
      conditionIndent,
    }];
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

function toolCallHasContiguousRequiredPathLines(
  toolCall: { function: { arguments: string } },
  requiredPath: string,
  expectedLines: readonly string[],
): boolean {
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    return typeof args.input === "string"
      && patchHasContiguousRequiredPathLines(args.input, requiredPath, expectedLines);
  } catch {
    return false;
  }
}

function patchHasContiguousRequiredPathLines(
  patch: string,
  requiredPath: string,
  expectedLines: readonly string[],
  compareTrimmedSource = false,
): boolean {
  let currentPath = "";
  let matchedLineCount = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("*** Update File: ")) {
      currentPath = normalizePath(line.slice("*** Update File: ".length));
      matchedLineCount = 0;
      continue;
    }
    if (currentPath !== requiredPath) {
      matchedLineCount = 0;
      continue;
    }
    const expectedLine = expectedLines[matchedLineCount];
    const comparableLine = compareTrimmedSource && /^[+-]/.test(line)
      ? `${line[0]}${line.slice(1).trimStart()}`
      : line;
    if (expectedLine !== undefined && comparableLine === expectedLine) {
      matchedLineCount++;
      if (matchedLineCount === expectedLines.length) return true;
      continue;
    }
    matchedLineCount = comparableLine === expectedLines[0] ? 1 : 0;
  }
  return false;
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
