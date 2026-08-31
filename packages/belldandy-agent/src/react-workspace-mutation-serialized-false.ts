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
