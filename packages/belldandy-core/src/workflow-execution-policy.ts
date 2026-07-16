import fs from "node:fs";
import path from "node:path";

import { assertSafeFilesystemRelativePath } from "@belldandy/protocol";

const APPROVAL_MANIFEST_FILENAME = "approved-workflows.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export type WorkflowExecutionPolicy = {
  workflowRoot: string;
  allowInline: boolean;
  /** 仅供已有本机脚本完成 manifest 迁移时显式开启，默认 false。 */
  allowLegacyFiles: boolean;
  approvedFileHashes: ReadonlyMap<string, string>;
  maxFileBytes: number;
};

type WorkflowApprovalManifest = {
  version: 1;
  workflows: Record<string, { sha256: string }>;
};

export function getWorkflowApprovalManifestPath(stateDir: string): string {
  return path.join(stateDir, "workflows", APPROVAL_MANIFEST_FILENAME);
}

/**
 * 工作流的可执行资格只由 Gateway 启动时读取的配置和批准 manifest 决定。
 * 请求参数、Tool 参数以及脚本自身均不能提高 source trust level。
 */
export function resolveWorkflowExecutionPolicy(input: {
  stateDir: string;
  readEnv: (name: string) => string | undefined;
}): WorkflowExecutionPolicy {
  const workflowRoot = path.join(input.stateDir, "workflows");
  return {
    workflowRoot,
    allowInline: input.readEnv("BELLDANDY_WORKFLOW_INLINE_ENABLED") === "true",
    allowLegacyFiles: input.readEnv("BELLDANDY_WORKFLOW_LEGACY_FILE_MODE") === "true",
    approvedFileHashes: readWorkflowApprovalManifest(getWorkflowApprovalManifestPath(input.stateDir)),
    maxFileBytes: resolveMaxFileBytes(input.readEnv("BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES")),
  };
}

function readWorkflowApprovalManifest(manifestPath: string): ReadonlyMap<string, string> {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return new Map();
    throw new Error("Invalid workflow approval manifest.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid workflow approval manifest.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid workflow approval manifest.");
  }
  const record = parsed as Partial<WorkflowApprovalManifest>;
  if (record.version !== 1 || !record.workflows || typeof record.workflows !== "object" || Array.isArray(record.workflows)) {
    throw new Error("Invalid workflow approval manifest.");
  }

  const approved = new Map<string, string>();
  for (const [relativePath, entry] of Object.entries(record.workflows)) {
    let safeRelativePath: string;
    try {
      safeRelativePath = assertSafeFilesystemRelativePath(relativePath, "workflow approval path");
    } catch {
      throw new Error("Invalid workflow approval manifest.");
    }
    const sha256 = entry && typeof entry === "object" ? (entry as { sha256?: unknown }).sha256 : undefined;
    if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
      throw new Error("Invalid workflow approval manifest.");
    }
    approved.set(safeRelativePath, sha256.toLowerCase());
  }
  return approved;
}

function resolveMaxFileBytes(raw: string | undefined): number {
  if (!raw?.trim()) return 1024 * 1024;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 16 * 1024 * 1024) {
    throw new Error("BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES must be an integer between 1024 and 16777216.");
  }
  return value;
}
