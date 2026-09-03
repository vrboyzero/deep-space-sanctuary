export type WorkspaceMutationLineDelta = {
  path: string;
  added: readonly string[];
  removed: readonly string[];
};

export type TraceValuesApiMigrationRegressionInput = {
  taskText: string;
  requiredPaths: readonly string[];
  priorChanges: readonly WorkspaceMutationLineDelta[];
  correctionChanges: readonly WorkspaceMutationLineDelta[];
  currentSources: ReadonlyMap<string, string>;
};

type TraceValuesApiMigrationRecoverySourceMessage = {
  role: string;
  content?: unknown;
};

export function rebuildTraceValuesApiMigrationToolCall<
  T extends { function: { name: string; arguments: string } },
>(input: {
  toolCall: T;
  messages: readonly TraceValuesApiMigrationRecoverySourceMessage[];
  taskText: string;
  priorSuccessfulPatchInputs: readonly string[];
  requiredPaths: readonly string[];
}): T | undefined {
  const requiredPaths = input.requiredPaths.map(normalizePath);
  if (input.toolCall.function.name !== "apply_patch"
    || input.priorSuccessfulPatchInputs.length !== 0
    || !taskMatchesFrozenMigration(input.taskText)
    || !hasExactPaths(requiredPaths, REQUIRED_PATHS)) {
    return undefined;
  }
  const attemptedPatch = readToolCallPatchInput(input.toolCall);
  if (!attemptedPatch || !isBoundedTraceValuesMigrationAttempt(attemptedPatch)) {
    return undefined;
  }
  const sources = readCompleteMigrationSources(input.messages);
  if (!sources) return undefined;

  const apiSource = sources.get(API_PATH) ?? "";
  const connectionSource = sources.get(CONNECTION_PATH) ?? "";
  const protocolSource = sources.get(PROTOCOL_PATH) ?? "";
  const connectionSequence = [
    "export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
    "",
    "/**",
    " * @deprecated Use TraceValue instead",
    " */",
    "export const TraceValues = TraceValue;",
    "export type TraceValues = TraceValue;",
    "",
    "export namespace Trace {",
  ];
  if (findExactLineSequenceStarts(connectionSource, connectionSequence).length !== 1
    || countIdentifierOccurrences(connectionSource, "TraceValues") !== 2) {
    return undefined;
  }

  const apiTraceValuesLines = apiSource.split(/\r?\n/).filter((line) => (
    hasIdentifier(line, "TraceValues")
  ));
  if (apiTraceValuesLines.length !== 2
    || countIdentifierOccurrences(apiSource, "TraceValues") !== 2) {
    return undefined;
  }
  const apiImportLine = apiTraceValuesLines.find((line) => (
    readNamedImportBodies(apiSource, "./connection").some((body) => (
      body.split(/\r?\n/).includes(line)
    ))
  ));
  const apiExportLine = apiTraceValuesLines.find((line) => (
    readNamedExportBodies(apiSource).some((body) => body.split(/\r?\n/).includes(line))
  ));
  const migratedApiImportLine = apiImportLine
    ? removeCommaListIdentifier(apiImportLine, "TraceValues")
    : undefined;
  const migratedApiExportLine = apiExportLine
    ? removeCommaListIdentifier(apiExportLine, "TraceValues")
    : undefined;
  if (!apiImportLine
    || !apiExportLine
    || apiImportLine === apiExportLine
    || !migratedApiImportLine
    || !migratedApiExportLine
    || !readNamedImportBodies(apiSource, "./connection").some((body) => (
      hasIdentifier(body, "TraceValue")
    ))
    || !readNamedExportBodies(apiSource).some((body) => hasIdentifier(body, "TraceValue"))) {
    return undefined;
  }

  const protocolImportLine = "import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';";
  const migratedProtocolImportLine = "import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';";
  const protocolFieldLine = "\ttrace?: TraceValues;";
  const migratedProtocolFieldLine = "\ttrace?: TraceValue;";
  if (countIdentifierOccurrences(protocolSource, "TraceValues") !== 2
    || protocolSource.split(/\r?\n/).filter((line) => line === protocolImportLine).length !== 1
    || protocolSource.split(/\r?\n/).filter((line) => line === protocolFieldLine).length !== 1
    || !readNamedImportBodies(protocolSource, "vscode-jsonrpc").some((body) => (
      body.split(/\r?\n/).includes(" ProgressToken, RequestHandler, TraceValues ")
        || body.split(/\r?\n/).includes("ProgressToken, RequestHandler, TraceValues")
    ))) {
    return undefined;
  }

  const patch = [
    "*** Begin Patch",
    `*** Update File: ${CONNECTION_PATH}`,
    "@@",
    ` ${connectionSequence[0]}`,
    "-",
    `-${connectionSequence[2]}`,
    `-${connectionSequence[3]}`,
    `-${connectionSequence[4]}`,
    `-${connectionSequence[5]}`,
    `-${connectionSequence[6]}`,
    " ",
    ` ${connectionSequence[8]}`,
    `*** Update File: ${API_PATH}`,
    "@@",
    `-${apiImportLine}`,
    `+${migratedApiImportLine}`,
    "@@",
    `-${apiExportLine}`,
    `+${migratedApiExportLine}`,
    `*** Update File: ${PROTOCOL_PATH}`,
    "@@",
    `-${protocolImportLine}`,
    `+${migratedProtocolImportLine}`,
    "@@",
    `-${protocolFieldLine}`,
    `+${migratedProtocolFieldLine}`,
    "*** End Patch",
  ].join("\n");
  return {
    ...input.toolCall,
    function: {
      ...input.toolCall.function,
      arguments: JSON.stringify({ input: patch }),
    },
  } as T;
}

const API_PATH = "jsonrpc/src/common/api.ts";
const CONNECTION_PATH = "jsonrpc/src/common/connection.ts";
const PROTOCOL_PATH = "protocol/src/common/protocol.ts";
const REQUIRED_PATHS = [API_PATH, CONNECTION_PATH, PROTOCOL_PATH] as const;

export function isRegressiveTraceValueImportCorrection(
  input: TraceValuesApiMigrationRegressionInput,
): boolean {
  const requiredPaths = input.requiredPaths.map(normalizePath);
  if (!hasExactPaths(requiredPaths, REQUIRED_PATHS)
    || !taskMatchesFrozenMigration(input.taskText)
    || !priorChangesMatchCompletedMigration(input.priorChanges)
    || !currentSourcesMatchCompletedMigration(input.currentSources)) {
    return false;
  }

  if (input.correctionChanges.length !== 1) return false;
  const correction = input.correctionChanges[0];
  if (!correction
    || normalizePath(correction.path) !== API_PATH
    || correction.removed.length !== 1
    || correction.added.length !== 1) {
    return false;
  }

  const removedLine = correction.removed[0] ?? "";
  const addedLine = correction.added[0] ?? "";
  if (!/^[\sA-Za-z0-9_$,]+$/.test(removedLine)
    || !hasIdentifier(removedLine, "TraceValue")
    || hasIdentifier(removedLine, "TraceValues")
    || removeCommaListIdentifier(removedLine, "TraceValue") !== addedLine) {
    return false;
  }

  const apiSource = input.currentSources.get(API_PATH) ?? "";
  return readNamedImportBodies(apiSource, "./connection").some((body) => (
    body.split(/\r?\n/).includes(removedLine)
  ));
}

function taskMatchesFrozenMigration(taskText: string): boolean {
  return taskText.includes("Remove the deprecated public TraceValues value/type aliases")
    && taskText.includes("remove both barrel exports")
    && taskText.includes("migrate protocol back to TraceValue")
    && taskText.includes("Change exactly jsonrpc/src/common/connection.ts, jsonrpc/src/common/api.ts, and protocol/src/common/protocol.ts");
}

function readCompleteMigrationSources(
  messages: readonly TraceValuesApiMigrationRecoverySourceMessage[],
): Map<string, string> | undefined {
  const sources = new Map<string, string>();
  const seenPaths = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "tool" || typeof message.content !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (typeof record.path !== "string") continue;
    const path = normalizePath(record.path);
    if (!REQUIRED_PATHS.includes(path as typeof REQUIRED_PATHS[number]) || seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    if (record.truncated !== false || typeof record.content !== "string") return undefined;
    sources.set(path, record.content);
  }
  return sources.size === REQUIRED_PATHS.length ? sources : undefined;
}

function readToolCallPatchInput(
  toolCall: { function: { arguments: string } },
): string | undefined {
  try {
    const parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    return typeof parsed?.input === "string" ? parsed.input : undefined;
  } catch {
    return undefined;
  }
}

function isBoundedTraceValuesMigrationAttempt(patchInput: string): boolean {
  const lines = patchInput.trim().split(/\r?\n/);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    return false;
  }
  const directives = lines.filter((line) => line.startsWith("*** ")
    && line !== "*** Begin Patch"
    && line !== "*** End Patch");
  return directives.length > 0
    && directives.every((line) => {
      const match = /^\*\*\* Update File:\s+(.+)$/.exec(line);
      return match !== null
        && REQUIRED_PATHS.includes(normalizePath(match[1] ?? "") as typeof REQUIRED_PATHS[number]);
    })
    && hasIdentifier(patchInput, "TraceValues");
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

function countIdentifierOccurrences(value: string, identifier: string): number {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...value.matchAll(new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, "gm"))].length;
}

function priorChangesMatchCompletedMigration(
  changes: readonly WorkspaceMutationLineDelta[],
): boolean {
  if (changes.length === 0
    || changes.some((change) => !REQUIRED_PATHS.includes(
      normalizePath(change.path) as typeof REQUIRED_PATHS[number],
    ))) {
    return false;
  }
  const linesFor = (path: string, key: "added" | "removed") => changes
    .filter((change) => normalizePath(change.path) === path)
    .flatMap((change) => change[key]);
  const connectionRemoved = linesFor(CONNECTION_PATH, "removed");
  const connectionAdded = linesFor(CONNECTION_PATH, "added");
  const apiRemoved = linesFor(API_PATH, "removed");
  const apiAdded = linesFor(API_PATH, "added");
  const protocolRemoved = linesFor(PROTOCOL_PATH, "removed");
  const protocolAdded = linesFor(PROTOCOL_PATH, "added");
  const allowedConnectionRemovalLines = new Set([
    "",
    "/**",
    " * @deprecated Use TraceValue instead",
    " */",
    "export const TraceValues = TraceValue;",
    "export type TraceValues = TraceValue;",
  ]);
  return connectionAdded.length === 0
    && connectionRemoved.every((line) => allowedConnectionRemovalLines.has(line.trimEnd()))
    && connectionRemoved.some((line) => line.trim() === "export const TraceValues = TraceValue;")
    && connectionRemoved.some((line) => line.trim() === "export type TraceValues = TraceValue;")
    && apiRemoved.length === 2
    && apiAdded.length === 2
    && apiRemoved.every((line) => {
      const replacement = removeCommaListIdentifier(line, "TraceValues");
      return replacement !== undefined && apiAdded.includes(replacement);
    })
    && hasExactLineSet(protocolRemoved, [
      "import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';",
      "\ttrace?: TraceValues;",
    ])
    && hasExactLineSet(protocolAdded, [
      "import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
      "\ttrace?: TraceValue;",
    ]);
}

function currentSourcesMatchCompletedMigration(
  sources: ReadonlyMap<string, string>,
): boolean {
  if (sources.size !== REQUIRED_PATHS.length) return false;
  const connectionSource = sources.get(CONNECTION_PATH) ?? "";
  const apiSource = sources.get(API_PATH) ?? "";
  const protocolSource = sources.get(PROTOCOL_PATH) ?? "";
  if ([connectionSource, apiSource, protocolSource].some((source) => (
    hasIdentifier(source, "TraceValues")
  ))) {
    return false;
  }
  return /\bexport\s+namespace\s+TraceValue\b/.test(connectionSource)
    && /\bexport\s+type\s+TraceValue\s*=/.test(connectionSource)
    && readNamedImportBodies(apiSource, "./connection").some((body) => (
      hasIdentifier(body, "TraceValue")
    ))
    && readNamedExportBodies(apiSource).some((body) => hasIdentifier(body, "TraceValue"))
    && readNamedImportBodies(protocolSource, "vscode-jsonrpc").some((body) => (
      hasIdentifier(body, "TraceValue")
    ))
    && /\btrace\?\s*:\s*TraceValue\s*;/.test(protocolSource);
}

function readNamedImportBodies(source: string, moduleName: string): string[] {
  const bodies: string[] = [];
  const pattern = /\bimport\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2\s*;/g;
  for (const match of source.matchAll(pattern)) {
    if (match[3] === moduleName) bodies.push(match[1] ?? "");
  }
  return bodies;
}

function readNamedExportBodies(source: string): string[] {
  return [...source.matchAll(/\bexport\s*\{([\s\S]*?)\}\s*;/g)]
    .map((match) => match[1] ?? "");
}

function removeCommaListIdentifier(line: string, identifier: string): string | undefined {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const followedByComma = new RegExp(`\\b${escaped}\\b\\s*,\\s*`);
  if (followedByComma.test(line)) return line.replace(followedByComma, "");
  const precededByComma = new RegExp(`,\\s*\\b${escaped}\\b`);
  if (precededByComma.test(line)) return line.replace(precededByComma, "");
  return undefined;
}

function hasIdentifier(value: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(value);
}

function hasExactPaths(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && [...actual].sort().every((path, index) => path === [...expected].sort()[index]);
}

function hasExactLineSet(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && [...actual].sort().every((line, index) => line === sortedExpected[index]);
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}
