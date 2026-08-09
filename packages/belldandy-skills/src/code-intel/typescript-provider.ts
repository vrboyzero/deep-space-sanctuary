import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import type {
  CodeIntelDiagnostic,
  CodeIntelEvidenceItem,
  CodeIntelProvider,
  CodeIntelProviderContext,
  CodeIntelProviderProfile,
  CodeIntelProviderRequest,
  CodeIntelProviderResult,
} from "./types.js";

const DEFAULT_MAX_PROJECTS = 32;
const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_WORKSPACE_SESSIONS = 4;
const DEFAULT_RESULT_LIMIT = 50;
const MAX_PROVIDER_CURSOR_OFFSET = 100_000;
const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const DISCOVERY_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/artifacts/**",
  "**/tmp/**",
  "**/.tmp/**",
];

export interface TypeScriptLanguageServiceProviderOptions {
  maxProjects?: number;
  maxFiles?: number;
  maxWorkspaceSessions?: number;
  onResourceEvent?: (event: TypeScriptProviderResourceEvent) => void;
}

export interface TypeScriptProviderResourceEvent {
  type: "session-created" | "session-reused" | "session-disposed";
  reason:
    | "cache-miss"
    | "cache-hit"
    | "lru-eviction"
    | "revision-reload"
    | "workspace-reload"
    | "provider-dispose";
  workspaceRevision: string;
  activeSessions: number;
}

interface WorkspaceSession {
  key: string;
  rootPath: string;
  revision: string;
  projects: ProjectSession[];
  diagnostics: CodeIntelDiagnostic[];
  lastUsed: number;
}

interface ProjectSession {
  kind: "configured" | "aggregate" | "inferred";
  fileNames: Set<string>;
  languageService: ts.LanguageService;
  setSignal(signal: AbortSignal | undefined): void;
}

interface ProviderCursor {
  version: 1;
  offset: number;
}

interface EvidenceSpan {
  fileName: string;
  textSpan: ts.TextSpan;
  kind?: ts.ScriptElementKind;
}

export class TypeScriptLanguageServiceProvider implements CodeIntelProvider {
  readonly profile: CodeIntelProviderProfile = {
    id: "typescript-language-service",
    version: ts.version,
    status: "available",
    operations: ["symbols", "definition", "references", "implementation"],
    capabilities: ["semantic-live"],
  };

  private readonly maxProjects: number;
  private readonly maxFiles: number;
  private readonly maxWorkspaceSessions: number;
  private readonly onResourceEvent?: (event: TypeScriptProviderResourceEvent) => void;
  private readonly sessions = new Map<string, WorkspaceSession>();
  private useCounter = 0;
  private disposed = false;

  constructor(options: TypeScriptLanguageServiceProviderOptions = {}) {
    this.maxProjects = normalizePositiveInteger(options.maxProjects, DEFAULT_MAX_PROJECTS);
    this.maxFiles = normalizePositiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
    this.maxWorkspaceSessions = normalizePositiveInteger(
      options.maxWorkspaceSessions,
      DEFAULT_MAX_WORKSPACE_SESSIONS,
    );
    this.onResourceEvent = options.onResourceEvent;
  }

  async query(
    request: CodeIntelProviderRequest,
    context: CodeIntelProviderContext,
  ): Promise<CodeIntelProviderResult> {
    if (this.disposed) {
      throw new Error("TypeScript Language Service Provider is disposed.");
    }
    throwIfAborted(context.signal);

    const session = this.getWorkspaceSession(request);
    const projects = selectProjects(session.projects, request);
    const diagnostics = [...session.diagnostics];
    const spans: EvidenceSpan[] = [];
    const offset = decodeProviderCursor(request.cursor);
    const limit = request.limit ?? DEFAULT_RESULT_LIMIT;
    const perProjectResultLimit = Math.min(offset + limit + 1, MAX_PROVIDER_CURSOR_OFFSET + 1);

    for (const project of projects) {
      throwIfAborted(context.signal);
      project.setSignal(context.signal);
      try {
        spans.push(...queryProject(project, request, diagnostics, perProjectResultLimit));
      } finally {
        project.setSignal(undefined);
      }
    }

    const items = deduplicateEvidence(spans.flatMap((span) => {
      const item = toEvidenceItem(span, session.rootPath, projects);
      return item === undefined ? [] : [item];
    }));
    const pageItems = items.slice(offset, offset + limit);
    const hasMore = offset + pageItems.length < items.length;

    return {
      status: diagnostics.length > 0 || hasMore ? "partial" : "completed",
      capability: "semantic-live",
      items: pageItems,
      freshness: { status: "fresh" },
      diagnostics,
      ...(hasMore ? { nextCursor: encodeProviderCursor({ version: 1, offset: offset + pageItems.length }) } : {}),
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const [key, session] of this.sessions) {
      this.sessions.delete(key);
      disposeWorkspaceSession(session);
      this.emitResourceEvent({
        type: "session-disposed",
        reason: "provider-dispose",
        workspaceRevision: session.revision,
        activeSessions: this.sessions.size,
      });
    }
  }

  private getWorkspaceSession(request: CodeIntelProviderRequest): WorkspaceSession {
    const rootPath = canonicalExistingPath(request.workspace.rootPath);
    const externalRoots = (request.workspace.externalRoots ?? [])
      .map(canonicalExistingPath)
      .sort(comparePaths);
    const key = [pathKey(rootPath), request.workspace.revision, ...externalRoots.map(pathKey)].join("\u0000");
    const cached = this.sessions.get(key);
    if (cached) {
      cached.lastUsed = ++this.useCounter;
      this.emitResourceEvent({
        type: "session-reused",
        reason: "cache-hit",
        workspaceRevision: cached.revision,
        activeSessions: this.sessions.size,
      });
      return cached;
    }

    for (const [existingKey, session] of this.sessions) {
      if (pathKey(session.rootPath) === pathKey(rootPath)) {
        this.sessions.delete(existingKey);
        disposeWorkspaceSession(session);
        this.emitResourceEvent({
          type: "session-disposed",
          reason: session.revision === request.workspace.revision
            ? "workspace-reload"
            : "revision-reload",
          workspaceRevision: session.revision,
          activeSessions: this.sessions.size,
        });
      }
    }

    this.evictSessionsForIncomingSession();
    const session = createWorkspaceSession({
      key,
      rootPath,
      revision: request.workspace.revision,
      externalRoots,
      maxProjects: this.maxProjects,
      maxFiles: this.maxFiles,
      lastUsed: ++this.useCounter,
    });
    this.sessions.set(key, session);
    this.emitResourceEvent({
      type: "session-created",
      reason: "cache-miss",
      workspaceRevision: session.revision,
      activeSessions: this.sessions.size,
    });
    return session;
  }

  private evictSessionsForIncomingSession(): void {
    while (this.sessions.size >= this.maxWorkspaceSessions) {
      const oldest = [...this.sessions.values()].sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!oldest) {
        return;
      }
      this.sessions.delete(oldest.key);
      disposeWorkspaceSession(oldest);
      this.emitResourceEvent({
        type: "session-disposed",
        reason: "lru-eviction",
        workspaceRevision: oldest.revision,
        activeSessions: this.sessions.size,
      });
    }
  }

  private emitResourceEvent(event: TypeScriptProviderResourceEvent): void {
    try {
      this.onResourceEvent?.(event);
    } catch {
      // Resource observation must never affect semantic query behavior.
    }
  }
}

function createWorkspaceSession(input: {
  key: string;
  rootPath: string;
  revision: string;
  externalRoots: string[];
  maxProjects: number;
  maxFiles: number;
  lastUsed: number;
}): WorkspaceSession {
  const diagnostics: CodeIntelDiagnostic[] = [];
  const readPolicy = createReadPolicy(input.rootPath, input.externalRoots);
  const configPaths = discoverConfigPaths(input.rootPath, readPolicy, input.maxProjects);
  const documentRegistry = ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, input.rootPath);
  const projects: ProjectSession[] = [];
  const workspaceFileNames = new Map<string, string>();
  let totalFiles = 0;

  if (configPaths.length === 0) {
    const fileNames = readPolicy.readDirectory(
      input.rootPath,
      SOURCE_EXTENSIONS,
      DISCOVERY_EXCLUDES,
      ["**/*"],
    );
    totalFiles += fileNames.length;
    for (const fileName of fileNames) {
      workspaceFileNames.set(pathKey(fileName), fileName);
    }
    if (totalFiles > input.maxFiles) {
      throw new Error(`TypeScript workspace exceeds the ${input.maxFiles} file limit.`);
    }
    projects.push(createProjectSession({
      kind: "inferred",
      rootPath: input.rootPath,
      revision: input.revision,
      fileNames,
      options: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
      },
      projectReferences: undefined,
      readPolicy,
      documentRegistry,
    }));
  } else {
    for (const configPath of configPaths) {
      const config = ts.readConfigFile(configPath, readPolicy.readFile);
      if (config.error) {
        diagnostics.push(toDiagnostic(config.error));
        continue;
      }
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        readPolicy,
        path.dirname(configPath),
        undefined,
        configPath,
      );
      diagnostics.push(...parsed.errors.map(toDiagnostic));
      const fileNames = parsed.fileNames.filter(readPolicy.isAllowedFile);
      totalFiles += fileNames.length;
      for (const fileName of fileNames) {
        workspaceFileNames.set(pathKey(fileName), fileName);
      }
      if (totalFiles > input.maxFiles) {
        throw new Error(`TypeScript workspace exceeds the ${input.maxFiles} file limit.`);
      }
      projects.push(createProjectSession({
        kind: "configured",
        rootPath: path.dirname(configPath),
        revision: input.revision,
        fileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
        readPolicy,
        documentRegistry,
      }));
    }

    if (projects.length > 1 && workspaceFileNames.size > 0) {
      projects.push(createProjectSession({
        kind: "aggregate",
        rootPath: input.rootPath,
        revision: input.revision,
        fileNames: [...workspaceFileNames.values()],
        options: {
          allowJs: true,
          checkJs: false,
          jsx: ts.JsxEmit.Preserve,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ES2022,
        },
        projectReferences: undefined,
        readPolicy,
        documentRegistry,
      }));
    }
  }

  if (projects.length === 0) {
    throw new Error("TypeScript workspace has no readable projects.");
  }
  return {
    key: input.key,
    rootPath: input.rootPath,
    revision: input.revision,
    projects,
    diagnostics: diagnostics.slice(0, 20),
    lastUsed: input.lastUsed,
  };
}

function createProjectSession(input: {
  kind: ProjectSession["kind"];
  rootPath: string;
  revision: string;
  fileNames: string[];
  options: ts.CompilerOptions;
  projectReferences: readonly ts.ProjectReference[] | undefined;
  readPolicy: ReturnType<typeof createReadPolicy>;
  documentRegistry: ts.DocumentRegistry;
}): ProjectSession {
  let activeSignal: AbortSignal | undefined;
  const normalizedFileNames = [...new Set(input.fileNames.map((fileName) => path.resolve(fileName)))];
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => input.options,
    getScriptFileNames: () => normalizedFileNames,
    getScriptVersion: (fileName) => fileVersion(fileName, input.readPolicy),
    getScriptSnapshot: (fileName) => {
      const content = input.readPolicy.readFile(fileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => input.rootPath,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getProjectReferences: () => input.projectReferences,
    getProjectVersion: () => input.revision,
    getCancellationToken: () => ({
      isCancellationRequested: () => activeSignal?.aborted ?? false,
    }),
    fileExists: input.readPolicy.fileExists,
    readFile: input.readPolicy.readFile,
    readDirectory: input.readPolicy.readDirectory,
    directoryExists: input.readPolicy.directoryExists,
    getDirectories: input.readPolicy.getDirectories,
    realpath: input.readPolicy.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
  return {
    kind: input.kind,
    fileNames: new Set(normalizedFileNames.map(pathKey)),
    languageService: ts.createLanguageService(host, input.documentRegistry),
    setSignal: (signal) => {
      activeSignal = signal;
    },
  };
}

function queryProject(
  project: ProjectSession,
  request: CodeIntelProviderRequest,
  diagnostics: CodeIntelDiagnostic[],
  resultLimit: number,
): EvidenceSpan[] {
  const service = project.languageService;
  if (request.operation === "symbols") {
    return service.getNavigateToItems(request.query, resultLimit).map((item) => ({
      fileName: item.fileName,
      textSpan: findSymbolNameSpan(
        service.getProgram()?.getSourceFile(item.fileName),
        item.textSpan,
        item.name,
      ),
      kind: item.kind,
    }));
  }

  const fileName = path.resolve(request.workspace.rootPath, request.location.path);
  const sourceFile = service.getProgram()?.getSourceFile(fileName);
  if (!sourceFile) {
    return [];
  }
  const position = positionToOffset(sourceFile, request.location.line, request.location.column);
  if (position === undefined) {
    diagnostics.push({ code: "invalid_location", message: "CodeIntel location is outside the source document." });
    return [];
  }

  if (request.operation === "definition") {
    return (service.getDefinitionAtPosition(fileName, position) ?? []).slice(0, resultLimit).map((item) => ({
      fileName: item.fileName,
      textSpan: item.textSpan,
      kind: item.kind,
    }));
  }
  if (request.operation === "references") {
    return (service.getReferencesAtPosition(fileName, position) ?? []).slice(0, resultLimit).map((item) => ({
      fileName: item.fileName,
      textSpan: item.textSpan,
      kind: service.getQuickInfoAtPosition(item.fileName, item.textSpan.start)?.kind,
    }));
  }
  return (service.getImplementationAtPosition(fileName, position) ?? []).slice(0, resultLimit).map((item) => ({
    fileName: item.fileName,
    textSpan: item.textSpan,
    kind: item.kind,
  }));
}

function findSymbolNameSpan(
  sourceFile: ts.SourceFile | undefined,
  declarationSpan: ts.TextSpan,
  symbolName: string,
): ts.TextSpan {
  if (!sourceFile || symbolName.length === 0) return declarationSpan;
  const declarationEnd = declarationSpan.start + declarationSpan.length;
  const nameStart = sourceFile.text.indexOf(symbolName, declarationSpan.start);
  if (nameStart < declarationSpan.start || nameStart + symbolName.length > declarationEnd) {
    return declarationSpan;
  }
  return { start: nameStart, length: symbolName.length };
}

function toEvidenceItem(
  span: EvidenceSpan,
  workspaceRoot: string,
  projects: ProjectSession[],
): CodeIntelEvidenceItem | undefined {
  const fileName = path.resolve(span.fileName);
  const sourceFile = projects
    .map((project) => project.languageService.getProgram()?.getSourceFile(fileName))
    .find((candidate) => candidate !== undefined)
    ?? readSourceFile(fileName);
  if (!sourceFile || span.textSpan.start < 0 || span.textSpan.start + span.textSpan.length > sourceFile.text.length) {
    return undefined;
  }
  const start = ts.getLineAndCharacterOfPosition(sourceFile, span.textSpan.start);
  const end = ts.getLineAndCharacterOfPosition(sourceFile, span.textSpan.start + span.textSpan.length);
  const insideWorkspace = isPathInside(workspaceRoot, fileName);
  return {
    location: {
      scope: insideWorkspace ? "workspace" : "external",
      path: insideWorkspace ? toPortableRelativePath(workspaceRoot, fileName) : fileName,
      range: {
        start: { line: start.line, column: start.character },
        end: { line: end.line, column: end.character },
      },
    },
    symbolKind: span.kind ?? ts.ScriptElementKind.unknown,
    documentRevision: documentRevision(sourceFile.text),
  };
}

function selectProjects(projects: ProjectSession[], request: CodeIntelProviderRequest): ProjectSession[] {
  if (request.operation === "symbols") {
    const aggregate = projects.find((project) => project.kind === "aggregate");
    return aggregate ? [aggregate] : projects;
  }
  const target = pathKey(path.resolve(request.workspace.rootPath, request.location.path));
  const matched = projects.filter((project) => project.fileNames.has(target));
  return matched.length > 0 ? matched : projects.slice(0, 1);
}

function discoverConfigPaths(
  rootPath: string,
  readPolicy: ReturnType<typeof createReadPolicy>,
  maxProjects: number,
): string[] {
  const rootConfigs = CONFIG_NAMES
    .map((name) => path.join(rootPath, name))
    .filter(readPolicy.fileExists);
  const discovered = readPolicy.readDirectory(
    rootPath,
    [".json"],
    DISCOVERY_EXCLUDES,
    ["**/tsconfig.json", "**/jsconfig.json"],
  );
  const configs = [...new Set([...rootConfigs, ...discovered])].sort((left, right) => {
    const rootRank = Number(rootConfigs.includes(right)) - Number(rootConfigs.includes(left));
    return rootRank || comparePaths(left, right);
  });
  if (configs.length > maxProjects) {
    throw new Error(`TypeScript workspace exceeds the ${maxProjects} project limit.`);
  }
  return configs;
}

function createReadPolicy(workspaceRoot: string, externalRoots: string[]) {
  const trustedTypeScriptRoot = canonicalExistingPath(path.dirname(ts.getDefaultLibFilePath({})));
  const allowedRoots = [workspaceRoot, trustedTypeScriptRoot, ...externalRoots].map(canonicalExistingPath);
  const isAllowedPath = (candidate: string): boolean => {
    const resolved = canonicalExistingPath(candidate);
    return allowedRoots.some((root) => isPathInside(root, resolved));
  };
  const isAllowedFile = (candidate: string): boolean => isAllowedPath(candidate);
  const isAllowedDirectory = (candidate: string): boolean => {
    const resolved = canonicalExistingPath(candidate);
    return allowedRoots.some((root) => isPathInside(root, resolved) || isPathInside(resolved, root));
  };
  const fileExists = (candidate: string): boolean => isAllowedPath(candidate) && ts.sys.fileExists(candidate);
  const readFile = (candidate: string): string | undefined => {
    if (!isAllowedPath(candidate)) {
      return undefined;
    }
    return ts.sys.readFile(candidate);
  };
  const directoryExists = (candidate: string): boolean => isAllowedDirectory(candidate)
    && (ts.sys.directoryExists?.(candidate) ?? false);
  const getDirectories = (candidate: string): string[] => {
    if (!isAllowedPath(candidate)) {
      return [];
    }
    return (ts.sys.getDirectories?.(candidate) ?? []).filter(isAllowedPath);
  };
  const readDirectory = (
    rootDir: string,
    extensions?: readonly string[],
    excludes?: readonly string[],
    includes?: readonly string[],
    depth?: number,
  ): string[] => {
    if (!isAllowedPath(rootDir)) {
      return [];
    }
    return ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth).filter(isAllowedPath);
  };
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists,
    readFile,
    directoryExists,
    getDirectories,
    readDirectory,
    isAllowedFile,
    realpath: (candidate: string) => isAllowedPath(candidate) ? canonicalExistingPath(candidate) : path.resolve(candidate),
  } satisfies ts.ParseConfigHost & {
    isAllowedFile(candidate: string): boolean;
    realpath(candidate: string): string;
  };
}

function fileVersion(fileName: string, readPolicy: ReturnType<typeof createReadPolicy>): string {
  if (!readPolicy.fileExists(fileName)) {
    return "missing";
  }
  try {
    const stats = fs.statSync(fileName);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "missing";
  }
}

function readSourceFile(fileName: string): ts.SourceFile | undefined {
  const content = ts.sys.readFile(fileName);
  return content === undefined
    ? undefined
    : ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
}

function positionToOffset(sourceFile: ts.SourceFile, line: number, column: number): number | undefined {
  if (line >= sourceFile.getLineStarts().length) {
    return undefined;
  }
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const nextLineStart = line + 1 < sourceFile.getLineStarts().length
    ? sourceFile.getPositionOfLineAndCharacter(line + 1, 0)
    : sourceFile.text.length;
  if (lineStart + column > nextLineStart) {
    return undefined;
  }
  return lineStart + column;
}

function deduplicateEvidence(items: CodeIntelEvidenceItem[]): CodeIntelEvidenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify([item.location, item.symbolKind, item.documentRevision]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function disposeWorkspaceSession(session: WorkspaceSession): void {
  for (const project of session.projects) {
    project.languageService.dispose();
  }
}

function documentRevision(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

function encodeProviderCursor(cursor: ProviderCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

function decodeProviderCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as Partial<ProviderCursor>;
    if (decoded.version !== 1
      || !Number.isInteger(decoded.offset)
      || Number(decoded.offset) < 0
      || Number(decoded.offset) > MAX_PROVIDER_CURSOR_OFFSET) {
      throw new Error("Invalid TypeScript Provider cursor.");
    }
    return Number(decoded.offset);
  } catch {
    throw new Error("Invalid TypeScript Provider cursor.");
  }
}

function toDiagnostic(diagnostic: ts.Diagnostic): CodeIntelDiagnostic {
  return {
    code: `typescript_${diagnostic.code}`,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
}

function canonicalExistingPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toPortableRelativePath(root: string, candidate: string): string {
  return path.relative(root, candidate).split(path.sep).join("/");
}

function pathKey(candidate: string): string {
  const resolved = path.resolve(candidate);
  return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
}

function comparePaths(left: string, right: string): number {
  return pathKey(left).localeCompare(pathKey(right));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value < 1 ? fallback : value;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("TypeScript CodeIntel query was aborted.", "AbortError");
  }
}
