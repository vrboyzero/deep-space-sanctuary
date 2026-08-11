import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  prepareGoplsStateRoot,
  type GoplsProcessProfile,
} from "./gopls-profile.js";
import {
  LspProcessHost,
  type LspProcessRequest,
  type LspServerProcessProfile,
} from "./lsp-process-host.js";
import type {
  CodeIntelDiagnostic,
  CodeIntelEvidenceItem,
  CodeIntelOperation,
  CodeIntelProvider,
  CodeIntelProviderContext,
  CodeIntelProviderProfile,
  CodeIntelProviderRequest,
  CodeIntelProviderResult,
  CodeIntelRange,
} from "./types.js";

const DEFAULT_RESULT_LIMIT = 50;
const MAX_RETAINED_RESULTS = 1_000;
const PROVIDER_CURSOR_VERSION = 1;
const MAX_SYNC_DOCUMENTS = 512;
const MAX_SYNC_DOCUMENT_BYTES = 1024 * 1024;
const MAX_SYNC_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_SYNC_DIRECTORIES = 4_096;
const GOPLS_SHUTDOWN_TIMEOUT_MS = 5_000;
const IGNORED_SYNC_DIRECTORIES = new Set([".git", ".hg", ".svn", "node_modules", "vendor"]);

const METHOD_BY_OPERATION: Record<CodeIntelOperation, string> = {
  symbols: "workspace/symbol",
  definition: "textDocument/definition",
  references: "textDocument/references",
  implementation: "textDocument/implementation",
};

const SYMBOL_KINDS: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum-member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type-parameter",
};

export interface GoplsCodeIntelHost {
  request<Result = unknown>(request: LspProcessRequest): Promise<Result>;
  notify(notification: LspProcessRequest): Promise<void>;
  waitForWorkspaceReady?(deadlineAtMs: number, signal?: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}

export type GoplsCodeIntelHostFactory = (input: {
  profile: LspServerProcessProfile;
  workspaceRoot: string;
  responseMaxBytes: number;
  shutdownTimeoutMs: number;
}) => GoplsCodeIntelHost | Promise<GoplsCodeIntelHost>;

export interface GoplsCodeIntelProviderOptions {
  profile: GoplsProcessProfile;
  hostFactory?: GoplsCodeIntelHostFactory;
  readFile?: (filePath: string) => string;
}

interface ActiveHost {
  revision: string;
  host: GoplsCodeIntelHost;
  workspaceSynchronized: boolean;
  workspaceReady: boolean;
}

interface ProviderCursor {
  version: typeof PROVIDER_CURSOR_VERSION;
  offset: number;
}

interface RawEvidenceLocation {
  uri: string;
  range: CodeIntelRange;
  symbolKind: string;
}

export class GoplsCodeIntelProvider implements CodeIntelProvider {
  readonly profile: CodeIntelProviderProfile;

  private readonly processProfile: GoplsProcessProfile;
  private readonly hostFactory: GoplsCodeIntelHostFactory;
  private readonly readFile: (filePath: string) => string;
  private activeHost: ActiveHost | undefined;
  private activeQuery = false;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;
  private failedHostCleanupPromise: Promise<void> | undefined;

  constructor(options: GoplsCodeIntelProviderOptions) {
    if (!options?.profile || options.profile.governance.productionEligible !== false) {
      throw new Error("gopls CodeIntel Provider requires a canary process profile.");
    }
    this.processProfile = options.profile;
    this.hostFactory = options.hostFactory ?? ((input) => new LspProcessHost(input));
    this.readFile = options.readFile ?? ((filePath) => fs.readFileSync(filePath, "utf8"));
    this.profile = {
      id: "gopls",
      version: options.profile.profile.version,
      status: "available",
      operations: [...options.profile.governance.capabilities],
      capabilities: ["semantic-live"],
    };
  }

  async query(
    request: CodeIntelProviderRequest,
    context: CodeIntelProviderContext,
  ): Promise<CodeIntelProviderResult> {
    this.throwIfDisposed();
    if (this.activeQuery) {
      throw new Error("gopls CodeIntel Provider already has an active query.");
    }
    validateProviderRequest(request, this.processProfile.workspaceRoot);
    throwIfAborted(context.signal);

    this.activeQuery = true;
    let activeHost: ActiveHost | undefined;
    try {
      activeHost = await this.resolveHost(request.workspace.revision, context.signal);
      await this.synchronizeWorkspace(activeHost, request.deadlineAtMs, context.signal);
      await this.waitForWorkspaceReadiness(activeHost, request.deadlineAtMs, context.signal);
      const response = await activeHost.host.request<unknown>({
        method: METHOD_BY_OPERATION[request.operation],
        params: buildLspParams(request),
        deadlineAtMs: request.deadlineAtMs,
        signal: context.signal,
      });
      throwIfAborted(context.signal);
      return normalizeLspResult(
        response,
        request,
        this.processProfile.externalEvidenceRoots,
        this.readFile,
        context.signal,
      );
    } catch (error) {
      if (activeHost) {
        await this.rejectFailedHost(activeHost, error);
      }
      throw error;
    } finally {
      this.activeQuery = false;
    }
  }

  dispose(): Promise<void> {
    return this.disposeAsync();
  }

  async disposeAsync(): Promise<void> {
    if (this.disposePromise) {
      await this.disposePromise;
      return;
    }
    this.disposed = true;
    const activeHost = this.activeHost;
    this.activeHost = undefined;
    this.disposePromise = Promise.all([
      activeHost?.host.dispose() ?? Promise.resolve(),
      this.failedHostCleanupPromise ?? Promise.resolve(),
    ]).then(() => undefined);
    await this.disposePromise;
  }

  private async resolveHost(revision: string, signal: AbortSignal): Promise<ActiveHost> {
    if (this.activeHost?.revision === revision) {
      return this.activeHost;
    }
    if (this.activeHost) {
      const staleHost = this.activeHost;
      this.activeHost = undefined;
      await staleHost.host.dispose();
      throwIfAborted(signal);
      this.throwIfDisposed();
    }
    await prepareGoplsStateRoot(this.processProfile);
    throwIfAborted(signal);
    this.throwIfDisposed();
    const host = await this.hostFactory({
      profile: this.processProfile.profile,
      workspaceRoot: this.processProfile.workspaceRoot,
      responseMaxBytes: this.processProfile.resourceLimits.decodedResponseMaxBytes,
      shutdownTimeoutMs: GOPLS_SHUTDOWN_TIMEOUT_MS,
    });
    this.activeHost = { revision, host, workspaceSynchronized: false, workspaceReady: false };
    return this.activeHost;
  }

  private async synchronizeWorkspace(
    activeHost: ActiveHost,
    deadlineAtMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (activeHost.workspaceSynchronized) return;
    const folders = this.processProfile.profile.workspaceFolders
      ?? [this.processProfile.workspaceRoot];
    const documents = discoverGoDocuments(this.processProfile.workspaceRoot, folders);
    let totalBytes = 0;
    for (const filePath of documents) {
      throwIfAborted(signal);
      const content = this.readFile(filePath);
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_SYNC_DOCUMENT_BYTES || totalBytes + bytes > MAX_SYNC_TOTAL_BYTES) {
        throw new Error("gopls workspace synchronization exceeded the canary byte limit.");
      }
      totalBytes += bytes;
      await activeHost.host.notify({
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: pathToFileURL(filePath).href,
            languageId: "go",
            version: 1,
            text: content,
          },
        },
        deadlineAtMs,
        signal,
      });
    }
    this.throwIfDisposed();
    activeHost.workspaceSynchronized = true;
  }

  private async waitForWorkspaceReadiness(
    activeHost: ActiveHost,
    deadlineAtMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (activeHost.workspaceReady) return;
    await activeHost.host.waitForWorkspaceReady?.(deadlineAtMs, signal);
    throwIfAborted(signal);
    this.throwIfDisposed();
    activeHost.workspaceReady = true;
  }

  private async rejectFailedHost(activeHost: ActiveHost, cause: unknown): Promise<never> {
    if (this.activeHost !== activeHost) throw cause;
    this.activeHost = undefined;
    const cleanupPromise = activeHost.host.dispose();
    this.failedHostCleanupPromise = cleanupPromise;
    try {
      await cleanupPromise;
    } catch (cleanupError) {
      throw new AggregateError(
        [cause, cleanupError],
        "gopls CodeIntel Host failed and could not be disposed cleanly.",
      );
    } finally {
      if (this.failedHostCleanupPromise === cleanupPromise) {
        this.failedHostCleanupPromise = undefined;
      }
    }
    throw cause;
  }

  private throwIfDisposed(): void {
    if (this.disposed) {
      throw new Error("gopls CodeIntel Provider is disposed.");
    }
  }
}

function discoverGoDocuments(workspaceRoot: string, folders: string[]): string[] {
  const queue = [...new Set(folders.map((folder) => path.resolve(folder)))].sort();
  const documents: string[] = [];
  let visitedDirectories = 0;
  while (queue.length > 0) {
    const directory = queue.shift()!;
    if (!isPathInside(workspaceRoot, directory)) {
      throw new Error("gopls workspace synchronization escaped the workspace root.");
    }
    visitedDirectories += 1;
    if (visitedDirectories > MAX_SYNC_DIRECTORIES) {
      throw new Error("gopls workspace synchronization exceeded the canary directory limit.");
    }
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !IGNORED_SYNC_DIRECTORIES.has(entry.name)) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".go") continue;
      documents.push(entryPath);
      if (documents.length > MAX_SYNC_DOCUMENTS) {
        throw new Error("gopls workspace synchronization exceeded the canary document limit.");
      }
    }
    queue.sort();
  }
  return documents.sort();
}

function validateProviderRequest(request: CodeIntelProviderRequest, workspaceRoot: string): void {
  if (pathKey(request.workspace.rootPath) !== pathKey(workspaceRoot)) {
    throw new Error("gopls CodeIntel Provider workspace does not match its process profile.");
  }
  if (!request.workspace.revision.trim() || !Number.isFinite(request.deadlineAtMs)) {
    throw new Error("gopls CodeIntel Provider request is invalid.");
  }
  if (request.operation !== "symbols") {
    const filePath = path.resolve(workspaceRoot, request.location.path);
    if (!isPathInside(workspaceRoot, filePath)
      || !isPosition(request.location.line, request.location.column)) {
      throw new Error("gopls CodeIntel Provider location is invalid.");
    }
  }
  decodeProviderCursor(request.cursor);
}

function buildLspParams(request: CodeIntelProviderRequest): unknown {
  if (request.operation === "symbols") {
    return { query: request.query };
  }
  const params = {
    textDocument: {
      uri: pathToFileURL(path.resolve(request.workspace.rootPath, request.location.path)).href,
    },
    position: {
      line: request.location.line,
      character: request.location.column,
    },
  };
  return request.operation === "references"
    ? { ...params, context: { includeDeclaration: true } }
    : params;
}

function normalizeLspResult(
  response: unknown,
  request: CodeIntelProviderRequest,
  externalEvidenceRoots: string[],
  readFile: (filePath: string) => string,
  signal: AbortSignal,
): CodeIntelProviderResult {
  const diagnostics: CodeIntelDiagnostic[] = [];
  const rawItems = extractRawEvidence(response, request.operation, diagnostics);
  const revisions = new Map<string, string | null>();
  const items: CodeIntelEvidenceItem[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    throwIfAborted(signal);
    const item = toEvidenceItem(
      rawItem,
      request,
      externalEvidenceRoots,
      readFile,
      revisions,
      diagnostics,
    );
    if (!item) continue;
    const key = JSON.stringify([item.location, item.symbolKind, item.documentRevision]);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  const offset = decodeProviderCursor(request.cursor);
  const limit = request.limit ?? DEFAULT_RESULT_LIMIT;
  const pageItems = items.slice(offset, offset + limit);
  const hasMore = offset + pageItems.length < items.length;
  return {
    status: diagnostics.length > 0 || hasMore ? "partial" : "completed",
    capability: "semantic-live",
    items: pageItems,
    freshness: { status: "fresh" },
    diagnostics,
    ...(hasMore
      ? { nextCursor: encodeProviderCursor({ version: PROVIDER_CURSOR_VERSION, offset: offset + pageItems.length }) }
      : {}),
  };
}

function extractRawEvidence(
  response: unknown,
  operation: CodeIntelOperation,
  diagnostics: CodeIntelDiagnostic[],
): RawEvidenceLocation[] {
  if (response === null || response === undefined) return [];
  if (!Array.isArray(response)) {
    diagnostics.push({
      code: "invalid_lsp_result",
      message: "gopls returned an invalid result collection.",
    });
    return [];
  }
  const bounded = response.slice(0, MAX_RETAINED_RESULTS);
  if (response.length > MAX_RETAINED_RESULTS) {
    diagnostics.push({
      code: "result_limit_exceeded",
      message: `gopls results were limited to ${MAX_RETAINED_RESULTS} items.`,
    });
  }
  return bounded.flatMap((value) => {
    const parsed = operation === "symbols"
      ? parseSymbolLocation(value)
      : parseLocation(value, "unknown");
    if (!parsed) {
      diagnostics.push({
        code: "invalid_location",
        message: "gopls returned a location that could not be projected safely.",
      });
      return [];
    }
    return [parsed];
  });
}

function parseSymbolLocation(value: unknown): RawEvidenceLocation | undefined {
  if (!isObjectRecord(value)) return undefined;
  return parseLocation(value.location, symbolKind(value.kind));
}

function parseLocation(value: unknown, kind: string): RawEvidenceLocation | undefined {
  if (!isObjectRecord(value)) return undefined;
  const uri = typeof value.uri === "string"
    ? value.uri
    : typeof value.targetUri === "string"
      ? value.targetUri
      : undefined;
  const range = parseRange(value.range ?? value.targetSelectionRange ?? value.targetRange);
  if (!uri || !range) return undefined;
  return { uri, range, symbolKind: kind };
}

function parseRange(value: unknown): CodeIntelRange | undefined {
  if (!isObjectRecord(value)
    || !isObjectRecord(value.start)
    || !isObjectRecord(value.end)) {
    return undefined;
  }
  const startLine = value.start.line;
  const startColumn = value.start.character;
  const endLine = value.end.line;
  const endColumn = value.end.character;
  if (!isPosition(startLine, startColumn)
    || !isPosition(endLine, endColumn)
    || Number(endLine) < Number(startLine)
    || (endLine === startLine && Number(endColumn) < Number(startColumn))) {
    return undefined;
  }
  return {
    start: { line: Number(startLine), column: Number(startColumn) },
    end: { line: Number(endLine), column: Number(endColumn) },
  };
}

function toEvidenceItem(
  rawItem: RawEvidenceLocation,
  request: CodeIntelProviderRequest,
  externalEvidenceRoots: string[],
  readFile: (filePath: string) => string,
  revisions: Map<string, string | null>,
  diagnostics: CodeIntelDiagnostic[],
): CodeIntelEvidenceItem | undefined {
  const filePath = toFilePath(rawItem.uri);
  if (!filePath) {
    diagnostics.push({
      code: "unsupported_uri",
      message: "gopls returned a non-file URI.",
    });
    return undefined;
  }
  const workspaceRoot = path.resolve(request.workspace.rootPath);
  const scope = isPathInside(workspaceRoot, filePath) ? "workspace" : "external";
  if (scope === "external") {
    if (!request.workspace.externalRoots?.some((root) => isPathInside(root, filePath))) {
      diagnostics.push({
        code: "external_location_not_allowed",
        message: "gopls returned a location outside the allowed evidence roots.",
      });
      return undefined;
    }
    if (!externalEvidenceRoots.some((root) => isPathInside(root, filePath))) {
      diagnostics.push({
        code: "profile_external_location_not_allowed",
        message: "gopls returned a location outside the Provider evidence allowlist.",
      });
      return undefined;
    }
  }
  const revision = readDocumentRevision(filePath, readFile, revisions);
  if (!revision) {
    diagnostics.push({
      code: "document_unreadable",
      message: "gopls returned a source document that could not be read safely.",
    });
    return undefined;
  }
  return {
    location: {
      scope,
      path: scope === "workspace" ? toPortableRelativePath(workspaceRoot, filePath) : filePath,
      range: rawItem.range,
    },
    symbolKind: rawItem.symbolKind,
    documentRevision: revision,
  };
}

function readDocumentRevision(
  filePath: string,
  readFile: (filePath: string) => string,
  revisions: Map<string, string | null>,
): string | undefined {
  const key = pathKey(filePath);
  if (revisions.has(key)) return revisions.get(key) ?? undefined;
  try {
    const content = readFile(filePath);
    const revision = `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
    revisions.set(key, revision);
    return revision;
  } catch {
    revisions.set(key, null);
    return undefined;
  }
}

function toFilePath(uri: string): string | undefined {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return undefined;
    return path.resolve(fileURLToPath(parsed));
  } catch {
    return undefined;
  }
}

function symbolKind(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value)
    ? SYMBOL_KINDS[value] ?? "unknown"
    : "unknown";
}

function encodeProviderCursor(cursor: ProviderCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeProviderCursor(value: string | undefined): number {
  if (value === undefined) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ProviderCursor>;
    if (parsed.version !== PROVIDER_CURSOR_VERSION
      || !Number.isInteger(parsed.offset)
      || Number(parsed.offset) < 0
      || Number(parsed.offset) > MAX_RETAINED_RESULTS) {
      throw new Error("invalid cursor");
    }
    return Number(parsed.offset);
  } catch {
    throw new Error("gopls CodeIntel Provider cursor is invalid.");
  }
}

function isPosition(line: unknown, column: unknown): boolean {
  return Number.isInteger(line) && Number(line) >= 0
    && Number.isInteger(column) && Number(column) >= 0;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toPortableRelativePath(root: string, candidate: string): string {
  return path.relative(root, candidate).split(path.sep).join("/");
}

function pathKey(candidate: string): string {
  const resolved = path.resolve(candidate);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("gopls CodeIntel query was aborted.", "AbortError");
  }
}
