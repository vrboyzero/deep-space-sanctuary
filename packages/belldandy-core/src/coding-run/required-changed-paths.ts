import path from "node:path";

export const MAX_REQUIRED_CHANGED_PATHS = 64;
export const MAX_REQUIRED_CHANGED_PATH_LENGTH = 512;

export type RequiredChangedPathsParseResult =
  | { ok: true; value?: string[] }
  | { ok: false; message: string };

export function parseRequiredChangedPaths(
  value: unknown,
  field = "codingRun.requiredChangedPaths",
): RequiredChangedPathsParseResult {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: `${field} must be a non-empty array` };
  }
  if (value.length > MAX_REQUIRED_CHANGED_PATHS) {
    return {
      ok: false,
      message: `${field} must contain at most ${MAX_REQUIRED_CHANGED_PATHS} paths`,
    };
  }

  const normalizedPaths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      return { ok: false, message: `${field} entries must be non-empty strings` };
    }
    const trimmed = candidate.trim();
    if (trimmed.length > MAX_REQUIRED_CHANGED_PATH_LENGTH) {
      return {
        ok: false,
        message: `${field} entries must be ${MAX_REQUIRED_CHANGED_PATH_LENGTH} characters or fewer`,
      };
    }
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
      return { ok: false, message: `${field} entries must not contain control characters` };
    }

    const normalized = trimmed.replace(/\\/g, "/");
    if (
      path.posix.isAbsolute(normalized)
      || path.win32.isAbsolute(trimmed)
      || /^[A-Za-z]:/.test(trimmed)
    ) {
      return { ok: false, message: `${field} entries must be workspace-relative paths` };
    }
    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      return { ok: false, message: `${field} entries must not contain . or .. segments` };
    }

    const identity = normalized.toLowerCase();
    if (seen.has(identity)) {
      return { ok: false, message: `${field} must not contain duplicates` };
    }
    seen.add(identity);
    normalizedPaths.push(normalized);
  }

  return { ok: true, value: normalizedPaths };
}
