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
