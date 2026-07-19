export type SubTaskRuntimeQuarantineKind = "invalid_json" | "invalid_schema" | "invalid_item" | "unreadable";

export type SubTaskRuntimeQuarantineStatus = {
  statePath: string;
  kind: SubTaskRuntimeQuarantineKind;
  detectedAt: number;
};

export class SubTaskRuntimeStateLoadError extends Error {
  constructor(readonly kind: Exclude<SubTaskRuntimeQuarantineKind, "unreadable">) {
    super(`Invalid subtask runtime registry (${kind}).`);
    this.name = "SubTaskRuntimeStateLoadError";
  }
}

export class SubTaskRuntimeStoreQuarantinedError extends Error {
  constructor(status: SubTaskRuntimeQuarantineStatus) {
    super(`Subtask runtime registry is in read-only quarantine (${status.kind}).`);
    this.name = "SubTaskRuntimeStoreQuarantinedError";
  }
}

function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/**
 * 只接受当前 v1 registry 的根结构；调用方再按业务规则验证每个 task item。
 */
export function parseSubTaskRuntimeRegistry(raw: string): { items: unknown[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripUtf8Bom(raw));
  } catch {
    throw new SubTaskRuntimeStateLoadError("invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SubTaskRuntimeStateLoadError("invalid_schema");
  }
  const source = parsed as Record<string, unknown>;
  if (source.version !== 1 || !Array.isArray(source.items)) {
    throw new SubTaskRuntimeStateLoadError("invalid_schema");
  }
  return { items: source.items };
}

export function createSubTaskRuntimeQuarantineStatus(
  statePath: string,
  error: unknown,
): SubTaskRuntimeQuarantineStatus {
  return {
    statePath,
    kind: error instanceof SubTaskRuntimeStateLoadError ? error.kind : "unreadable",
    detectedAt: Date.now(),
  };
}
