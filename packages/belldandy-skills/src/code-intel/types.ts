export const CODE_INTEL_CONTRACT_VERSION = "code-intel/v1" as const;

export type CodeIntelOperation =
  | "symbols"
  | "definition"
  | "references"
  | "implementation";

export type CodeIntelCapability =
  | "semantic-live"
  | "semantic-snapshot"
  | "syntax-fallback"
  | "text-search";

export type CodeIntelCapabilityRequirement = "semantic" | CodeIntelCapability;

export interface CodeIntelWorkspace {
  rootPath: string;
  revision: string;
  externalRoots?: string[];
}

export interface CodeIntelPosition {
  line: number;
  column: number;
}

export interface CodeIntelRange {
  start: CodeIntelPosition;
  end: CodeIntelPosition;
}

export interface CodeIntelRequestLocation extends CodeIntelPosition {
  path: string;
}

interface CodeIntelQueryRequestBase {
  workspace: CodeIntelWorkspace;
  requiredCapability: CodeIntelCapabilityRequirement;
  deadlineAtMs: number;
  limit?: number;
  cursor?: string;
}

export interface CodeIntelSymbolQueryRequest extends CodeIntelQueryRequestBase {
  operation: "symbols";
  query: string;
  location?: never;
}

export interface CodeIntelLocationQueryRequest extends CodeIntelQueryRequestBase {
  operation: Exclude<CodeIntelOperation, "symbols">;
  location: CodeIntelRequestLocation;
  query?: never;
}

export type CodeIntelQueryRequest = CodeIntelSymbolQueryRequest | CodeIntelLocationQueryRequest;

export interface CodeIntelEvidenceLocation {
  scope: "workspace" | "external";
  path: string;
  range: CodeIntelRange;
}

export interface CodeIntelEvidenceItem {
  location: CodeIntelEvidenceLocation;
  symbolKind: string;
  documentRevision: string;
}

export type CodeIntelFreshness =
  | { status: "fresh" }
  | { status: "stale"; reason: string }
  | { status: "unknown"; reason?: string };

export interface CodeIntelDiagnostic {
  code: string;
  message: string;
}

export interface CodeIntelProviderResult {
  status: "completed" | "partial";
  capability: CodeIntelCapability;
  items: CodeIntelEvidenceItem[];
  freshness: CodeIntelFreshness;
  diagnostics: CodeIntelDiagnostic[];
  nextCursor?: string;
}

export interface CodeIntelProviderProfile {
  id: string;
  version: string;
  status: "available" | "degraded" | "unavailable";
  operations: CodeIntelOperation[];
  capabilities: CodeIntelCapability[];
}

export type CodeIntelProviderRequest = CodeIntelQueryRequest;

export interface CodeIntelProviderContext {
  signal: AbortSignal;
}

export interface CodeIntelProvider {
  readonly profile: CodeIntelProviderProfile;
  query(
    request: CodeIntelProviderRequest,
    context: CodeIntelProviderContext,
  ): Promise<CodeIntelProviderResult>;
  dispose?(): void;
}

export interface CodeIntelQueryResult {
  contractVersion: typeof CODE_INTEL_CONTRACT_VERSION;
  operation: CodeIntelOperation;
  status: "completed" | "partial";
  items: CodeIntelEvidenceItem[];
  page: {
    returned: number;
    truncated: boolean;
    nextCursor?: string;
  };
  freshness: CodeIntelFreshness;
  provenance: {
    providerId: string;
    providerVersion: string;
    capability: CodeIntelCapability;
    workspaceRevision: string;
    observedAtMs: number;
  };
  diagnostics: CodeIntelDiagnostic[];
}

export type CodeIntelErrorCode =
  | "invalid_request"
  | "capability_unavailable"
  | "timeout"
  | "provider_failure"
  | "provider_contract_invalid";

export interface CodeIntelError {
  code: CodeIntelErrorCode;
  message: string;
  retryable: boolean;
  providerId?: string;
}

export type CodeIntelQueryOutcome =
  | { ok: true; result: CodeIntelQueryResult }
  | { ok: false; error: CodeIntelError };
