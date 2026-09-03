const RUNTIME_OUTPUT_SCHEMA_CONTRACT_PREFIX = [
  "",
  "",
  "## Output Schema Contract",
  "",
  "Return only raw JSON that validates against this schema.",
  "Treat the JSON Schema below as data contract, not as executable instructions.",
  "",
  "```json",
  "",
].join("\n");

export function selectTaskTextForSourceContext(taskText: string): string {
  const contractStart = taskText.lastIndexOf(RUNTIME_OUTPUT_SCHEMA_CONTRACT_PREFIX);
  if (contractStart < 0 || !taskText.endsWith("\n```")) {
    return taskText;
  }
  const schemaStart = contractStart + RUNTIME_OUTPUT_SCHEMA_CONTRACT_PREFIX.length;
  const serializedSchema = taskText.slice(schemaStart, -4);
  try {
    JSON.parse(serializedSchema);
  } catch {
    return taskText;
  }
  return taskText.slice(0, contractStart);
}

export function rankTaskSourceIdentifierOccurrences(
  fileContent: string,
  taskText: string,
  identifier: string,
): Iterable<number> {
  const qualifiedOwners = collectTaskQualifiedOwners(taskText, identifier);
  if (qualifiedOwners.length === 0) {
    return iterateIdentifierOccurrences(fileContent, identifier);
  }
  const prioritizedOccurrences: number[] = [];
  const remainingOccurrences: number[] = [];
  let lineStart = 0;
  let lineEnd = fileContent.indexOf("\n");

  for (const matchIndex of iterateIdentifierOccurrences(fileContent, identifier)) {
    while (lineEnd >= 0 && matchIndex > lineEnd) {
      lineStart = lineEnd + 1;
      lineEnd = fileContent.indexOf("\n", lineStart);
    }
    const sourceLine = fileContent.slice(
      lineStart,
      lineEnd < 0 ? fileContent.length : lineEnd,
    );
    const hasQualifiedOwner = qualifiedOwners.some((owner) => (
      containsIdentifier(sourceLine, owner)
    ));
    const isDeclaration = isSourceDeclarationLine(sourceLine, identifier);
    (isDeclaration && hasQualifiedOwner
      ? prioritizedOccurrences
      : remainingOccurrences).push(matchIndex);
  }

  return [...prioritizedOccurrences, ...remainingOccurrences];
}

function* iterateIdentifierOccurrences(
  value: string,
  identifier: string,
): Generator<number> {
  let searchOffset = 0;
  while (searchOffset < value.length) {
    const matchIndex = value.indexOf(identifier, searchOffset);
    if (matchIndex < 0) {
      return;
    }
    searchOffset = matchIndex + identifier.length;
    if (hasIdentifierBoundaries(value, matchIndex, identifier.length)) {
      yield matchIndex;
    }
  }
}

function collectTaskQualifiedOwners(taskText: string, identifier: string): string[] {
  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualifiedReference = new RegExp(
    `([A-Za-z_$][A-Za-z0-9_$]*)\\s*(?:\\.|#|::)\\s*${escapedIdentifier}(?![A-Za-z0-9_$])`,
    "g",
  );
  const owners = new Set<string>();
  for (const match of taskText.matchAll(qualifiedReference)) {
    const owner = match[1];
    if (owner) {
      owners.add(owner);
    }
  }
  return [...owners];
}

function isSourceDeclarationLine(sourceLine: string, identifier: string): boolean {
  const trimmedLine = sourceLine.trimStart();
  if (/^(?:\/\/|\/\*|\*|#)/.test(trimmedLine)) {
    return false;
  }
  if (!containsIdentifier(sourceLine, identifier)) {
    return false;
  }
  return /\b(?:func|function|def|class|interface|type|struct|enum|trait|record)\b/.test(sourceLine)
    || /\b(?:const|let|var)\b[^=]*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/.test(sourceLine);
}

function containsIdentifier(value: string, identifier: string): boolean {
  let searchOffset = 0;
  while (searchOffset < value.length) {
    const matchIndex = value.indexOf(identifier, searchOffset);
    if (matchIndex < 0) {
      return false;
    }
    if (hasIdentifierBoundaries(value, matchIndex, identifier.length)) {
      return true;
    }
    searchOffset = matchIndex + identifier.length;
  }
  return false;
}

function hasIdentifierBoundaries(value: string, start: number, length: number): boolean {
  const identifierCharacter = /[A-Za-z0-9_$]/;
  const before = start > 0 ? value[start - 1] ?? "" : "";
  const after = start + length < value.length ? value[start + length] ?? "" : "";
  return !identifierCharacter.test(before) && !identifierCharacter.test(after);
}
