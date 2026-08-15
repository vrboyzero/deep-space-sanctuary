import path from "node:path";

import type { JsonObject } from "./types.js";

const MAX_CHANGED_PATHS = 64;
const MAX_CHANGED_PATH_LENGTH = 512;

export function buildWorkspaceMutationResultMetadata(
  changedPaths: readonly string[],
): JsonObject {
  const normalized = normalizeChangedPaths(changedPaths);
  if (!normalized) {
    throw new Error("workspace mutation result changedPaths are invalid");
  }
  return {
    workspaceMutation: {
      schemaVersion: 1,
      changedPaths: normalized,
    },
  };
}

export function readWorkspaceMutationChangedPaths(metadata: unknown): string[] | undefined {
  if (!isRecord(metadata)) return undefined;
  const workspaceMutation = metadata.workspaceMutation;
  if (!isRecord(workspaceMutation) || workspaceMutation.schemaVersion !== 1) return undefined;
  return normalizeChangedPaths(workspaceMutation.changedPaths);
}

function normalizeChangedPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGED_PATHS) {
    return undefined;
  }
  const normalizedPaths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !candidate || candidate.length > MAX_CHANGED_PATH_LENGTH) {
      return undefined;
    }
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return undefined;
    const normalized = candidate.replace(/\\/g, "/");
    if (
      path.posix.isAbsolute(normalized)
      || path.win32.isAbsolute(candidate)
      || /^[A-Za-z]:/.test(candidate)
    ) {
      return undefined;
    }
    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      return undefined;
    }
    const identity = normalized.toLowerCase();
    if (seen.has(identity)) return undefined;
    seen.add(identity);
    normalizedPaths.push(normalized);
  }
  return normalizedPaths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
