export function readSiblingBranchBody(
  lines: readonly string[],
  branchIndex: number,
): string[] {
  const indent = /^([ \t]*)/.exec(lines[branchIndex] ?? "")?.[1] ?? "";
  const body: string[] = [];
  for (let index = branchIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      body.push(line);
      continue;
    }
    if (line.startsWith(indent)) {
      const remainder = line.slice(indent.length);
      if (!/^[ \t]/.test(remainder) && /^}\s*(?:else\b|$)/.test(remainder)) {
        break;
      }
    }
    body.push(line);
  }
  return body;
}

export function branchReceivesFalseExcludedByPreviousSibling(
  lines: readonly string[],
  branchIndex: number,
): boolean {
  const currentBranch = lines[branchIndex] ?? "";
  const currentMatch = /^([ \t]*)}\s*else\s+if\s*\((.+)\)\s*\{\s*$/.exec(currentBranch);
  const currentPredicate = currentMatch?.[2] ?? "";
  if (!currentMatch
    || !/\bvalue\s*!=\s*NULL\b/.test(currentPredicate)
    || /\bvalue\s*!==?\s*false\b/.test(currentPredicate)) {
    return false;
  }
  const indent = currentMatch[1] ?? "";
  for (let index = branchIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index] ?? "";
    const candidateMatch = /^([ \t]*)}\s*else\s+if\s*\(/.exec(candidate);
    if (!candidateMatch || candidateMatch[1] !== indent) continue;
    if (index + readSiblingBranchBody(lines, index).length + 1 !== branchIndex) continue;
    return /^\s*}\s*else\s+if\s*\(\s*value\s*!=\s*NULL\s*&&\s*value\s*!==\s*false\s*\)\s*\{\s*$/.test(
      candidate,
    );
  }
  return false;
}

export function branchAdmitsUnrestrictedBooleanFalse(condition: string): boolean {
  return /^\s*}\s*else\s+if\s*\(\s*typeof\s+value\s*={2,3}\s*(['"])boolean\1\s*&&\s*!\s*value\s*\)\s*\{\s*$/.test(condition);
}

export type SerializedFalseMultilineFallbackBranch = {
  fallbackCondition: string;
  fallbackStatement: string;
  branchEnd: string;
  conditionIndent: string;
  statementIndent: string;
  ordinaryFalseRemoved: boolean;
};

const FUNCTION_ATTRIBUTE_GUARD = "if (typeof value == 'function') {";
const FUNCTION_ATTRIBUTE_COMMENT = "// never serialize functions as attribute values";
const NULLISH_REMOVAL_CONDITION = "} else if (value == NULL) {";
const ATTRIBUTE_REMOVAL_STATEMENT = "dom.removeAttribute(name);";
const MULTILINE_CONDITION_START = "} else if (";
const ARIA_PREFIX_PREDICATE = "(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||";
const DATA_PREFIX_PREDICATE = "(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')";
const MULTILINE_CONDITION_END = ") {";
const SERIALIZED_FALSE_ATTRIBUTE_STATEMENT = "dom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));";
const UNCONDITIONAL_FALLBACK = "} else {";
const GUARDED_ORDINARY_FALLBACK = "} else if (value !== false) {";
const ORDINARY_ATTRIBUTE_STATEMENT = "dom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
const SERIALIZED_FALSE_LITERAL_STATEMENT = "dom.setAttribute(name, 'false');";
const DROPPED_FALLBACK_NULLISH_CONDITION = "if (value == NULL) {";
const NARROW_PREFIX_PREDICATE = "name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a'";
const NARROW_PREFIX_FALSE_REMOVAL_CONDITION = `} else if (value === false && !(${NARROW_PREFIX_PREDICATE})) {`;
const NARROW_PREFIX_FALSE_SERIALIZATION_CONDITION = `} else if (value === false && (${NARROW_PREFIX_PREDICATE})) {`;

export function hasNormalizedSerializedFalseAttributeBranch(
  lines: readonly string[],
): boolean {
  for (let index = 0; index <= lines.length - 14; index += 1) {
    const declaration = lines[index] ?? "";
    const conditionIndent = declaration.slice(
      0,
      declaration.length - declaration.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    const nestedConditionIndent = `${statementIndent}`;
    const nestedStatementIndent = `${nestedConditionIndent}\t`;
    if (declaration === `${conditionIndent}const normalized = value == NULL || typeof value == 'function' ? NULL : value;`
      && lines[index + 1] === `${conditionIndent}if (normalized == NULL) {`
      && lines[index + 2] === `${statementIndent}${ATTRIBUTE_REMOVAL_STATEMENT}`
      && lines[index + 3] === `${conditionIndent}} else if (normalized === false) {`
      && lines[index + 4] === `${nestedConditionIndent}if ${ARIA_PREFIX_PREDICATE.slice(0, -3)} {`
      && lines[index + 5] === `${nestedStatementIndent}${SERIALIZED_FALSE_LITERAL_STATEMENT}`
      && lines[index + 6] === `${nestedConditionIndent}} else if ${DATA_PREFIX_PREDICATE} {`
      && lines[index + 7] === `${nestedStatementIndent}${SERIALIZED_FALSE_LITERAL_STATEMENT}`
      && lines[index + 8] === `${nestedConditionIndent}} else {`
      && lines[index + 9] === `${nestedStatementIndent}${ATTRIBUTE_REMOVAL_STATEMENT}`
      && lines[index + 10] === `${nestedConditionIndent}}`
      && lines[index + 11] === `${conditionIndent}} else {`
      && lines[index + 12] === `${statementIndent}dom.setAttribute(name, name == 'popover' && normalized == true ? '' : normalized);`
      && lines[index + 13] === `${conditionIndent}}`) {
      return true;
    }
  }
  return false;
}

export function collectSerializedFalseMultilineFallbackBranches(
  lines: readonly string[],
): SerializedFalseMultilineFallbackBranch[] {
  const branches: SerializedFalseMultilineFallbackBranch[] = [];
  for (let index = 0; index <= lines.length - 12; index += 1) {
    const functionGuard = lines[index] ?? "";
    const conditionIndent = functionGuard.slice(
      0,
      functionGuard.length - functionGuard.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    if (functionGuard !== `${conditionIndent}${FUNCTION_ATTRIBUTE_GUARD}`
      || lines[index + 1] !== `${statementIndent}${FUNCTION_ATTRIBUTE_COMMENT}`
      || lines[index + 2] !== `${conditionIndent}${NULLISH_REMOVAL_CONDITION}`
      || lines[index + 3] !== `${statementIndent}${ATTRIBUTE_REMOVAL_STATEMENT}`
      || lines[index + 4] !== `${conditionIndent}${MULTILINE_CONDITION_START}`
      || lines[index + 5] !== `${statementIndent}${ARIA_PREFIX_PREDICATE}`
      || lines[index + 6] !== `${statementIndent}${DATA_PREFIX_PREDICATE}`
      || lines[index + 7] !== `${conditionIndent}${MULTILINE_CONDITION_END}`
      || lines[index + 8] !== `${statementIndent}${SERIALIZED_FALSE_ATTRIBUTE_STATEMENT}`) {
      continue;
    }

    const fallbackCondition = lines[index + 9] ?? "";
    const fallbackStatement = lines[index + 10] ?? "";
    if (fallbackStatement !== `${statementIndent}${ORDINARY_ATTRIBUTE_STATEMENT}`) {
      continue;
    }
    if (fallbackCondition === `${conditionIndent}${UNCONDITIONAL_FALLBACK}`
      && lines[index + 11] === `${conditionIndent}}`) {
      branches.push({
        fallbackCondition,
        fallbackStatement,
        branchEnd: lines[index + 11]!,
        conditionIndent,
        statementIndent,
        ordinaryFalseRemoved: false,
      });
      continue;
    }
    if (fallbackCondition === `${conditionIndent}${GUARDED_ORDINARY_FALLBACK}`
      && lines[index + 11] === `${conditionIndent}${UNCONDITIONAL_FALLBACK}`
      && lines[index + 12] === `${statementIndent}${ATTRIBUTE_REMOVAL_STATEMENT}`
      && lines[index + 13] === `${conditionIndent}}`) {
      branches.push({
        fallbackCondition,
        fallbackStatement,
        branchEnd: lines[index + 13]!,
        conditionIndent,
        statementIndent,
        ordinaryFalseRemoved: true,
      });
    }
  }
  return branches;
}

export function hasGroupedSerializedFalseMultilineBranch(
  lines: readonly string[],
): boolean {
  for (let index = 0; index <= lines.length - 10; index += 1) {
    const branchStart = lines[index] ?? "";
    const conditionIndent = branchStart.slice(
      0,
      branchStart.length - branchStart.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    if (branchStart === `${conditionIndent}${MULTILINE_CONDITION_START}`
      && lines[index + 1] === `${statementIndent}value === false && (`
      && lines[index + 2] === `${statementIndent}${ARIA_PREFIX_PREDICATE}`
      && lines[index + 3] === `${statementIndent}${DATA_PREFIX_PREDICATE}`
      && lines[index + 4] === `${statementIndent})`
      && lines[index + 5] === `${conditionIndent}${MULTILINE_CONDITION_END}`
      && lines[index + 6] === `${statementIndent}${SERIALIZED_FALSE_LITERAL_STATEMENT}`
      && lines[index + 7] === `${conditionIndent}${UNCONDITIONAL_FALLBACK}`
      && lines[index + 8] === `${statementIndent}${ATTRIBUTE_REMOVAL_STATEMENT}`
      && lines[index + 9] === `${conditionIndent}}`) {
      return true;
    }
  }
  return false;
}

export function hasDroppedSerializedFalseNarrowPrefixFallback(
  lines: readonly string[],
): boolean {
  for (let index = 0; index <= lines.length - 7; index += 1) {
    const nullishCondition = lines[index] ?? "";
    const conditionIndent = nullishCondition.slice(
      0,
      nullishCondition.length - nullishCondition.trimStart().length,
    );
    const statementIndent = `${conditionIndent}\t`;
    if (nullishCondition === `${conditionIndent}${DROPPED_FALLBACK_NULLISH_CONDITION}`
      && lines[index + 1] === `${statementIndent}${ATTRIBUTE_REMOVAL_STATEMENT}`
      && lines[index + 2] === `${conditionIndent}${NARROW_PREFIX_FALSE_REMOVAL_CONDITION}`
      && lines[index + 3] === `${statementIndent}${ATTRIBUTE_REMOVAL_STATEMENT}`
      && lines[index + 4] === `${conditionIndent}${NARROW_PREFIX_FALSE_SERIALIZATION_CONDITION}`
      && lines[index + 5] === `${statementIndent}${SERIALIZED_FALSE_LITERAL_STATEMENT}`
      && lines[index + 6] === `${conditionIndent}}`) {
      return true;
    }
  }
  return false;
}
