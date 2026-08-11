import { createHash } from "node:crypto";
import path from "node:path";

import {
  CODE_INTEL_CONTRACT_VERSION,
  type CodeIntelCapability,
  type CodeIntelCapabilityRequirement,
  type CodeIntelError,
  type CodeIntelEvidenceItem,
  type CodeIntelProvider,
  type CodeIntelProviderProfile,
  type CodeIntelProviderRequest,
  type CodeIntelProviderResult,
  type CodeIntelQueryOutcome,
  type CodeIntelQueryRequest,
} from "./types.js";

const DEFAULT_RESULT_LIMIT = 50;
const MAX_RESULT_LIMIT = 200;

export interface CodeIntelOptions {
  providers: CodeIntelProvider[];
  now?: () => number;
}

interface CursorPayload {
  version: 1;
  providerId: string;
  operation: CodeIntelQueryRequest["operation"];
  workspaceRevision: string;
  requestBinding: string;
  providerCursor: string;
}

export class CodeIntel {
  private readonly providers: CodeIntelProvider[];
  private readonly now: () => number;
  private disposePromise: Promise<void> | undefined;

  constructor(options: CodeIntelOptions) {
    this.providers = [...options.providers];
    this.now = options.now ?? Date.now;
  }

  async query(request: CodeIntelQueryRequest): Promise<CodeIntelQueryOutcome> {
    const requestError = validateRequest(request);
    if (requestError) {
      return { ok: false, error: requestError };
    }

    const cursor = request.cursor === undefined
      ? undefined
      : decodeCursor(request.cursor, request);
    if (request.cursor !== undefined && cursor === undefined) {
      return { ok: false, error: invalidRequest("CodeIntel cursor is invalid for this query.") };
    }

    const provider = this.selectProvider(request, cursor?.providerId);
    if (!provider) {
      return { ok: false, error: capabilityUnavailable() };
    }

    if (!profileSatisfiesRequirement(provider.profile, request.requiredCapability)) {
      return { ok: false, error: capabilityUnavailable() };
    }

    const remainingMs = request.deadlineAtMs - this.now();
    if (remainingMs <= 0) {
      return { ok: false, error: timeoutError(provider.profile.id) };
    }

    const controller = new AbortController();
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const providerRequest: CodeIntelProviderRequest = {
      ...request,
      ...(cursor === undefined ? {} : { cursor: cursor.providerCursor }),
    };

    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new CodeIntelTimeout());
        }, remainingMs);
      });
      const providerResult = await Promise.race([
        provider.query(providerRequest, { signal: controller.signal }),
        timeout,
      ]);
      const observedAtMs = this.now();
      if (observedAtMs >= request.deadlineAtMs) {
        controller.abort();
        return { ok: false, error: timeoutError(provider.profile.id) };
      }

      const resultError = validateProviderResult(provider.profile, request, providerResult);
      if (resultError) {
        return { ok: false, error: resultError };
      }

      return {
        ok: true,
        result: buildQueryResult(provider.profile, request, providerResult, observedAtMs),
      };
    } catch {
      if (timedOut) {
        return { ok: false, error: timeoutError(provider.profile.id) };
      }
      return {
        ok: false,
        error: {
          code: "provider_failure",
          message: "CodeIntel Provider failed to answer the query.",
          retryable: true,
          providerId: provider.profile.id,
        },
      };
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  dispose(): void {
    void this.disposeAsync();
  }

  async disposeAsync(): Promise<void> {
    if (!this.disposePromise) {
      this.disposePromise = Promise.all(this.providers.map(async (provider) => {
        try {
          await provider.dispose?.();
        } catch {
          // Disposal is best-effort so one Provider cannot prevent releasing the rest.
        }
      })).then(() => undefined);
    }
    await this.disposePromise;
  }

  private selectProvider(
    request: CodeIntelQueryRequest,
    cursorProviderId?: string,
  ): CodeIntelProvider | undefined {
    return this.providers.find((provider) => {
      const profile = provider.profile;
      return profile.status !== "unavailable"
        && profile.operations.includes(request.operation)
        && profileSatisfiesRequirement(profile, request.requiredCapability)
        && (cursorProviderId === undefined || profile.id === cursorProviderId);
    });
  }
}

class CodeIntelTimeout extends Error {}

function buildQueryResult(
  profile: CodeIntelProviderProfile,
  request: CodeIntelQueryRequest,
  providerResult: CodeIntelProviderResult,
  observedAtMs: number,
) {
  const limit = request.limit ?? DEFAULT_RESULT_LIMIT;
  const items = providerResult.items.slice(0, limit).map(normalizeEvidenceItem);
  const hasMoreItems = providerResult.items.length > limit;
  const truncated = hasMoreItems || providerResult.nextCursor !== undefined;
  const nextCursor = providerResult.nextCursor === undefined
    ? undefined
    : encodeCursor({
        version: 1,
        providerId: profile.id,
        operation: request.operation,
        workspaceRevision: request.workspace.revision,
        requestBinding: buildRequestBinding(request),
        providerCursor: providerResult.nextCursor,
      });

  return {
    contractVersion: CODE_INTEL_CONTRACT_VERSION,
    operation: request.operation,
    status: providerResult.status === "partial"
      || providerResult.freshness.status !== "fresh"
      || truncated
      ? "partial" as const
      : "completed" as const,
    items,
    page: {
      returned: items.length,
      truncated,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
    freshness: normalizeFreshness(providerResult.freshness),
    provenance: {
      providerId: profile.id,
      providerVersion: profile.version,
      capability: providerResult.capability,
      workspaceRevision: request.workspace.revision,
      observedAtMs,
    },
    diagnostics: providerResult.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
    })),
  };
}

function validateRequest(request: CodeIntelQueryRequest): CodeIntelError | undefined {
  if (!request || typeof request !== "object") {
    return invalidRequest("CodeIntel request must be an object.");
  }
  if (!request.workspace || !path.isAbsolute(request.workspace.rootPath)) {
    return invalidRequest("CodeIntel workspace rootPath must be absolute.");
  }
  if (!isNonEmptyString(request.workspace.revision)) {
    return invalidRequest("CodeIntel workspace revision is required.");
  }
  if (request.workspace.externalRoots?.some((root) => !path.isAbsolute(root))) {
    return invalidRequest("CodeIntel external roots must be absolute.");
  }
  if (request.operation === "symbols") {
    if (!isNonEmptyString(request.query)) {
      return invalidRequest("CodeIntel symbol query must be non-empty.");
    }
  } else if (!isSafeRelativePath(request.location?.path)
    || !isPosition(request.location)) {
    return invalidRequest("CodeIntel query location must stay inside the workspace.");
  }
  if (!Number.isFinite(request.deadlineAtMs)) {
    return invalidRequest("CodeIntel deadlineAtMs must be finite.");
  }
  if (request.limit !== undefined
    && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_RESULT_LIMIT)) {
    return invalidRequest(`CodeIntel limit must be between 1 and ${MAX_RESULT_LIMIT}.`);
  }
  return undefined;
}

function validateProviderResult(
  profile: CodeIntelProviderProfile,
  request: CodeIntelQueryRequest,
  result: CodeIntelProviderResult,
): CodeIntelError | undefined {
  if (!result || typeof result !== "object"
    || !profile.capabilities.includes(result.capability)
    || !capabilitySatisfiesRequirement(result.capability, request.requiredCapability)
    || (result.status !== "completed" && result.status !== "partial")
    || !Array.isArray(result.items)
    || !isValidFreshness(result.freshness)
    || !Array.isArray(result.diagnostics)
    || result.diagnostics.some((diagnostic) => !isValidDiagnostic(diagnostic))) {
    return providerContractInvalid(profile.id, "CodeIntel Provider returned an invalid contract result.");
  }

  if (result.nextCursor !== undefined && !isNonEmptyString(result.nextCursor)) {
    return providerContractInvalid(profile.id, "CodeIntel Provider returned an invalid continuation cursor.");
  }

  for (const item of result.items) {
    if (!isValidEvidenceItem(item, request)) {
      return providerContractInvalid(
        profile.id,
        "CodeIntel Provider returned evidence outside the allowed workspace scope.",
      );
    }
  }
  return undefined;
}

function isValidEvidenceItem(item: CodeIntelEvidenceItem, request: CodeIntelQueryRequest): boolean {
  if (!item || typeof item !== "object"
    || !isNonEmptyString(item.symbolKind)
    || !isNonEmptyString(item.documentRevision)
    || !isRange(item.location?.range)) {
    return false;
  }

  if (item.location.scope === "workspace") {
    return isSafeRelativePath(item.location.path)
      && isPathInside(request.workspace.rootPath, path.resolve(request.workspace.rootPath, item.location.path));
  }
  if (item.location.scope === "external") {
    return path.isAbsolute(item.location.path)
      && (request.workspace.externalRoots ?? []).some((root) => isPathInside(root, item.location.path));
  }
  return false;
}

function isRange(range: unknown): boolean {
  if (!range || typeof range !== "object") {
    return false;
  }
  const candidate = range as { start?: unknown; end?: unknown };
  if (!isPosition(candidate.start) || !isPosition(candidate.end)) {
    return false;
  }
  return candidate.end.line > candidate.start.line
    || (candidate.end.line === candidate.start.line && candidate.end.column >= candidate.start.column);
}

function isValidFreshness(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const freshness = value as { status?: unknown; reason?: unknown };
  if (freshness.status === "fresh") {
    return hasOnlyKeys(value, ["status"]);
  }
  if (freshness.status === "stale") {
    return hasOnlyKeys(value, ["status", "reason"]) && isNonEmptyString(freshness.reason);
  }
  if (freshness.status === "unknown") {
    return hasOnlyKeys(value, ["status", "reason"])
      && (freshness.reason === undefined || isNonEmptyString(freshness.reason));
  }
  return false;
}

function isValidDiagnostic(value: unknown): boolean {
  if (!value || typeof value !== "object" || !hasOnlyKeys(value, ["code", "message"])) {
    return false;
  }
  const diagnostic = value as { code?: unknown; message?: unknown };
  return isNonEmptyString(diagnostic.code) && isNonEmptyString(diagnostic.message);
}

function normalizeEvidenceItem(item: CodeIntelEvidenceItem): CodeIntelEvidenceItem {
  return {
    location: {
      scope: item.location.scope,
      path: item.location.path,
      range: {
        start: { line: item.location.range.start.line, column: item.location.range.start.column },
        end: { line: item.location.range.end.line, column: item.location.range.end.column },
      },
    },
    symbolKind: item.symbolKind,
    documentRevision: item.documentRevision,
  };
}

function normalizeFreshness(freshness: CodeIntelProviderResult["freshness"]): CodeIntelProviderResult["freshness"] {
  if (freshness.status === "fresh") {
    return { status: "fresh" };
  }
  if (freshness.status === "stale") {
    return { status: "stale", reason: freshness.reason };
  }
  return {
    status: "unknown",
    ...(freshness.reason === undefined ? {} : { reason: freshness.reason }),
  };
}

function hasOnlyKeys(value: object, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPosition(value: unknown): value is { line: number; column: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const position = value as { line?: unknown; column?: unknown };
  return Number.isInteger(position.line)
    && Number(position.line) >= 0
    && Number.isInteger(position.column)
    && Number(position.column) >= 0;
}

function isSafeRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || path.isAbsolute(value)) {
    return false;
  }
  const normalized = path.normalize(value);
  return normalized !== ".."
    && !normalized.startsWith(`..${path.sep}`)
    && !path.isAbsolute(normalized);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function profileSatisfiesRequirement(
  profile: CodeIntelProviderProfile,
  requirement: CodeIntelCapabilityRequirement,
): boolean {
  return profile.capabilities.some((capability) => capabilitySatisfiesRequirement(capability, requirement));
}

function capabilitySatisfiesRequirement(
  capability: CodeIntelCapability,
  requirement: CodeIntelCapabilityRequirement,
): boolean {
  if (requirement === "semantic") {
    return capability === "semantic-live" || capability === "semantic-snapshot";
  }
  return capability === requirement;
}

function encodeCursor(cursor: CursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

function decodeCursor(
  value: string,
  request: CodeIntelQueryRequest,
): CursorPayload | undefined {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Partial<CursorPayload>;
    if (decoded.version !== 1
      || !isNonEmptyString(decoded.providerId)
      || decoded.operation !== request.operation
      || decoded.workspaceRevision !== request.workspace.revision
      || decoded.requestBinding !== buildRequestBinding(request)
      || !isNonEmptyString(decoded.providerCursor)) {
      return undefined;
    }
    return decoded as CursorPayload;
  } catch {
    return undefined;
  }
}

function buildRequestBinding(request: CodeIntelQueryRequest): string {
  const query = request.operation === "symbols"
    ? { query: request.query }
    : { location: request.location };
  const payload = {
    workspaceRoot: path.resolve(request.workspace.rootPath),
    externalRoots: (request.workspace.externalRoots ?? []).map((root) => path.resolve(root)).sort(),
    operation: request.operation,
    requiredCapability: request.requiredCapability,
    ...query,
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf-8").digest("hex");
}

function invalidRequest(message: string): CodeIntelError {
  return { code: "invalid_request", message, retryable: false };
}

function capabilityUnavailable(): CodeIntelError {
  return {
    code: "capability_unavailable",
    message: "Required CodeIntel capability is unavailable.",
    retryable: false,
  };
}

function timeoutError(providerId: string): CodeIntelError {
  return {
    code: "timeout",
    message: "CodeIntel query exceeded its deadline.",
    retryable: true,
    providerId,
  };
}

function providerContractInvalid(providerId: string, message: string): CodeIntelError {
  return {
    code: "provider_contract_invalid",
    message,
    retryable: false,
    providerId,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
