import { collectSerializedFalseMultilineFallbackBranches } from "./react-workspace-mutation-serialized-false.js";

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
const SVG_EXCLUDED_BOOLEAN_FALSE_CONDITION_SUFFIX = "} else if (typeof value == 'boolean' && !value && !isSvg) {";
const SVG_INCLUSIVE_BOOLEAN_FALSE_CONDITION_SUFFIX = "} else if (typeof value == 'boolean' && !value) {";
const BOOLEAN_FALSE_BRANCH_COMMENT = "// False for boolean attributes (aria-/, data-/) means false.";
const BOOLEAN_FALSE_PREFIX_CONDITION = "if (/^(aria|data)-/.test(name)) {";
const MULTILINE_ARIA_PREFIX_PREDICATE = "(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||";
const MULTILINE_DATA_PREFIX_PREDICATE = "(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')";
const MULTILINE_SERIALIZED_FALSE_STATEMENT = "dom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));";
const NULLISH_REMOVAL_CONDITION_SUFFIX = "} else if (value == NULL) {";
const GUARDED_ORDINARY_FALLBACK_SUFFIX = "} else if (value !== false) {";
const DROPPED_FALLBACK_NULLISH_CONDITION_SUFFIX = "if (value == NULL) {";
const DROPPED_FALLBACK_NARROW_PREFIX_PREDICATE = "name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a'";
const DROPPED_FALLBACK_NARROW_PREFIX_STUB_SUFFIX = `} else if (${DROPPED_FALLBACK_NARROW_PREFIX_PREDICATE}) {`;
const DROPPED_FALLBACK_NARROW_FALSE_REMOVAL_SUFFIX = `} else if (value === false && !(${DROPPED_FALLBACK_NARROW_PREFIX_PREDICATE})) {`;

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

type DroppedFallbackNarrowPrefixStub = {
  nullishCondition: string;
  removalStatement: string;
  prefixCondition: string;
  branchEnd: string;
  conditionIndent: string;
  statementIndent: string;
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

export function rebuildSerializedFalseDroppedFallbackToolCall<
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
  const priorMatches = requiredPath && priorPatchReplacedBaselineWithNarrowPrefixStub(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  );
  if (!requiredPath || !priorMatches) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const stubs = collectDroppedFallbackNarrowPrefixStubs(source);
  if (stubs.length !== 1) return undefined;
  const stub = stubs[0]!;
  if (!toolCallHasSingleRequiredPathUpdateDirective(input.toolCall, requiredPath)
    || !toolCallHasContiguousRequiredPathLines(input.toolCall, requiredPath, [
    `-${stub.nullishCondition}`,
    `+${stub.nullishCondition}`,
    ` ${stub.removalStatement}`,
    `-${stub.prefixCondition}`,
    `-${stub.branchEnd}`,
    `+${stub.conditionIndent}${DROPPED_FALLBACK_NARROW_FALSE_REMOVAL_SUFFIX}`,
    `+${stub.removalStatement}`,
    `+${stub.conditionIndent}${INITIAL_NARROW_PREFIX_SERIALIZED_FALSE_CONDITION_SUFFIX}`,
    `+${stub.statementIndent}${SERIALIZED_FALSE_LITERAL_STATEMENT}`,
    `+${stub.branchEnd}`,
  ])) {
    return undefined;
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${requiredPath}`,
    "@@",
    `-${stub.nullishCondition}`,
    `-${stub.removalStatement}`,
    `-${stub.prefixCondition}`,
    `-${stub.branchEnd}`,
    `+${stub.conditionIndent}${FUNCTION_ATTRIBUTE_GUARD_SUFFIX}`,
    `+${stub.statementIndent}${FUNCTION_ATTRIBUTE_COMMENT}`,
    `+${stub.conditionIndent}${NULLISH_REMOVAL_CONDITION_SUFFIX}`,
    `+${stub.removalStatement}`,
    `+${stub.conditionIndent}${MULTILINE_SERIALIZED_FALSE_CONDITION_START_SUFFIX}`,
    `+${stub.statementIndent}${MULTILINE_ARIA_PREFIX_PREDICATE}`,
    `+${stub.statementIndent}${MULTILINE_DATA_PREFIX_PREDICATE}`,
    `+${stub.conditionIndent}${MULTILINE_SERIALIZED_FALSE_CONDITION_END_SUFFIX}`,
    `+${stub.statementIndent}${MULTILINE_SERIALIZED_FALSE_STATEMENT}`,
    `+${stub.conditionIndent}${GUARDED_ORDINARY_FALLBACK_SUFFIX}`,
    `+${stub.statementIndent}${EXISTING_ATTRIBUTE_STATEMENT}`,
    `+${stub.conditionIndent}} else {`,
    `+${stub.removalStatement}`,
    `+${stub.branchEnd}`,
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
  const priorPatchAddedSvgExcludedBooleanBranch = priorPatchAddedLine(
    input.priorSuccessfulPatchInputs,
    requiredPath,
    SVG_EXCLUDED_BOOLEAN_FALSE_CONDITION_SUFFIX,
  );
  const priorPatchAddedMultilineFallbackBranch = priorPatchAddedSerializedFalseMultilineFallbackBranch(
    input.priorSuccessfulPatchInputs,
    requiredPath,
  );
  if (!requiredPath
    || (input.correctionReason === "serialized_false_nullish_serialization_requires_atomic_repair"
      ? !priorPatchAddedNullishBranch
      : !priorPatchAddedBroadCondition
        && !priorPatchAddedSvgExcludedBooleanBranch
        && !priorPatchAddedMultilineFallbackBranch)) return undefined;

  const source = readCompleteSource(input.messages, requiredPath);
  if (!source) return undefined;
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  if (input.correctionReason !== "serialized_false_nullish_serialization_requires_atomic_repair"
    && priorPatchAddedMultilineFallbackBranch
    && requiresSerializedFalseTruthSet(input.taskText)) {
    const branches = collectSerializedFalseMultilineFallbackBranches(source.split(/\r?\n/))
      .filter((branch) => !branch.ordinaryFalseRemoved);
    if (branches.length !== 1) return undefined;
    const branch = branches[0]!;
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${input.requiredPaths[0]}`,
      "@@",
      `-${branch.fallbackCondition}`,
      `-${branch.fallbackStatement}`,
      `+${branch.conditionIndent}${GUARDED_ORDINARY_FALLBACK_SUFFIX}`,
      `+${branch.fallbackStatement}`,
      `+${branch.conditionIndent}} else {`,
      `+${branch.statementIndent}${EXISTING_REMOVAL_STATEMENT}`,
      ` ${branch.branchEnd}`,
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
  if (input.correctionReason !== "serialized_false_nullish_serialization_requires_atomic_repair"
    && priorPatchAddedSvgExcludedBooleanBranch) {
    const branches = collectSvgExcludedBooleanFalseBranches(source);
    if (branches.length !== 1) return undefined;
    const branch = branches[0]!;
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${input.requiredPaths[0]}`,
      "@@",
      `-${branch.condition}`,
      `+${branch.indent}${SVG_INCLUSIVE_BOOLEAN_FALSE_CONDITION_SUFFIX}`,
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

function priorPatchAddedLine(
  patchInputs: readonly string[],
  requiredPath: string,
  lineSuffix: string,
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
        && line.slice(1).trimStart() === lineSuffix) {
        return true;
      }
    }
    return false;
  });
}

function priorPatchAddedSerializedFalseMultilineFallbackBranch(
  patchInputs: readonly string[],
  requiredPath: string,
): boolean {
  if (patchInputs.length !== 1) return false;
  let currentPath = "";
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const line of patchInputs[0]!.split(/\r?\n/)) {
    if (line.startsWith("*** Update File: ")) {
      currentPath = normalizePath(line.slice("*** Update File: ".length));
      continue;
    }
    if (line.startsWith("*** ")) {
      currentPath = "";
      continue;
    }
    if (currentPath !== requiredPath) continue;
    if (line.startsWith("+")) added.add(line.slice(1).trimStart());
    if (line.startsWith("-")) removed.add(line.slice(1).trimStart());
  }
  return removed.has(PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX)
    && removed.has(EXISTING_ATTRIBUTE_STATEMENT)
    && removed.has(EXISTING_REMOVAL_STATEMENT)
    && added.has(NULLISH_REMOVAL_CONDITION_SUFFIX)
    && added.has(MULTILINE_SERIALIZED_FALSE_CONDITION_START_SUFFIX)
    && added.has(MULTILINE_ARIA_PREFIX_PREDICATE)
    && added.has(MULTILINE_DATA_PREFIX_PREDICATE)
    && added.has(MULTILINE_SERIALIZED_FALSE_CONDITION_END_SUFFIX)
    && added.has(MULTILINE_SERIALIZED_FALSE_STATEMENT)
    && added.has(EXISTING_ATTRIBUTE_STATEMENT);
}

function collectSvgExcludedBooleanFalseBranches(
  source: string,
): Array<{ condition: string; indent: string }> {
  const lines = source.split(/\r?\n/);
  const branches: Array<{ condition: string; indent: string }> = [];
  for (let index = 0; index <= lines.length - 12; index += 1) {
    const condition = lines[index] ?? "";
    const indent = condition.slice(0, condition.length - condition.trimStart().length);
    if (condition.trimStart() !== SVG_EXCLUDED_BOOLEAN_FALSE_CONDITION_SUFFIX
      || (lines[index + 1] ?? "").trim() !== BOOLEAN_FALSE_BRANCH_COMMENT
      || (lines[index + 2] ?? "").trim() !== BOOLEAN_FALSE_PREFIX_CONDITION
      || (lines[index + 3] ?? "").trim() !== SERIALIZED_FALSE_LITERAL_STATEMENT
      || (lines[index + 4] ?? "").trim() !== "} else {"
      || (lines[index + 5] ?? "").trim() !== EXISTING_REMOVAL_STATEMENT
      || (lines[index + 6] ?? "").trim() !== "}"
      || (lines[index + 7] ?? "").trim() !== PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX
      || (lines[index + 8] ?? "").trim() !== EXISTING_ATTRIBUTE_STATEMENT
      || (lines[index + 9] ?? "").trim() !== "} else {"
      || (lines[index + 10] ?? "").trim() !== EXISTING_REMOVAL_STATEMENT
      || (lines[index + 11] ?? "").trim() !== "}") {
      continue;
    }
    branches.push({ condition, indent });
  }
  return branches;
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

function priorPatchReplacedBaselineWithNarrowPrefixStub(
  patchInputs: readonly string[],
  requiredPath: string,
): boolean {
  if (patchInputs.length !== 1) return false;
  const patchInput = patchInputs[0]!;
  const change = readSingleRequiredPathPatchChange({
    function: { arguments: JSON.stringify({ input: patchInput }) },
  }, requiredPath);
  if (!change) return false;
  const normalizeLines = (lines: readonly string[]) => lines.map((line) => line.trimStart());
  return JSON.stringify(normalizeLines(change.removed)) === JSON.stringify([
    FUNCTION_ATTRIBUTE_GUARD_SUFFIX,
    FUNCTION_ATTRIBUTE_COMMENT,
    PREVIOUS_SERIALIZED_FALSE_CONDITION_SUFFIX,
    EXISTING_ATTRIBUTE_STATEMENT,
    "} else {",
    EXISTING_REMOVAL_STATEMENT,
  ]) && JSON.stringify(normalizeLines(change.added)) === JSON.stringify([
    DROPPED_FALLBACK_NULLISH_CONDITION_SUFFIX,
    EXISTING_REMOVAL_STATEMENT,
    DROPPED_FALLBACK_NARROW_PREFIX_STUB_SUFFIX,
  ]);
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

function collectDroppedFallbackNarrowPrefixStubs(
  source: string,
): DroppedFallbackNarrowPrefixStub[] {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((nullishCondition, index) => {
    if (nullishCondition.trimStart() !== DROPPED_FALLBACK_NULLISH_CONDITION_SUFFIX) return [];
    const conditionIndent = nullishCondition.slice(
      0,
      nullishCondition.length - nullishCondition.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    const removalStatement = lines[index + 1] ?? "";
    const prefixCondition = lines[index + 2] ?? "";
    const branchEnd = lines[index + 3] ?? "";
    if (removalStatement !== `${statementIndent}${EXISTING_REMOVAL_STATEMENT}`
      || prefixCondition !== `${conditionIndent}${DROPPED_FALLBACK_NARROW_PREFIX_STUB_SUFFIX}`
      || branchEnd !== `${conditionIndent}}`) {
      return [];
    }
    return [{
      nullishCondition,
      removalStatement,
      prefixCondition,
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
  if (!patchHasSingleRequiredPathUpdateDirective(patch, requiredPath)) return undefined;
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

function toolCallHasSingleRequiredPathUpdateDirective(
  toolCall: { function: { arguments: string } },
  requiredPath: string,
): boolean {
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    return typeof args.input === "string"
      && patchHasSingleRequiredPathUpdateDirective(args.input, requiredPath);
  } catch {
    return false;
  }
}

function patchHasSingleRequiredPathUpdateDirective(
  patch: string,
  requiredPath: string,
): boolean {
  const fileDirectives = patch.split(/\r?\n/).filter((line) =>
    line.startsWith("*** Update File: ")
    || line.startsWith("*** Add File: ")
    || line.startsWith("*** Delete File: ")
    || line.startsWith("*** Move to: "));
  return fileDirectives.length === 1
    && fileDirectives[0] === `*** Update File: ${requiredPath}`;
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
