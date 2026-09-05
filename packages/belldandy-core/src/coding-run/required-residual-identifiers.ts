export const MAX_REQUIRED_RESIDUAL_IDENTIFIERS = 32;
export const MAX_REQUIRED_RESIDUAL_IDENTIFIER_LENGTH = 256;

export type RequiredResidualIdentifiersParseResult =
  | { ok: true; value?: string[] }
  | { ok: false; message: string };

/**
 * 解析 required mutation 客观复核阶段的「禁止残留标识符」列表。
 * 只允许纯文本标识符（不得包含控制字符）；用于逐路径残留扫描反馈，不含路径语义。
 */
export function parseRequiredResidualIdentifiers(
  value: unknown,
  field = "codingRun.requiredResidualIdentifiers",
): RequiredResidualIdentifiersParseResult {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: `${field} must be a non-empty array` };
  }
  if (value.length > MAX_REQUIRED_RESIDUAL_IDENTIFIERS) {
    return {
      ok: false,
      message: `${field} must contain at most ${MAX_REQUIRED_RESIDUAL_IDENTIFIERS} identifiers`,
    };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      return { ok: false, message: `${field} entries must be non-empty strings` };
    }
    const trimmed = candidate.trim();
    if (trimmed.length > MAX_REQUIRED_RESIDUAL_IDENTIFIER_LENGTH) {
      return {
        ok: false,
        message: `${field} entries must be ${MAX_REQUIRED_RESIDUAL_IDENTIFIER_LENGTH} characters or fewer`,
      };
    }
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
      return { ok: false, message: `${field} entries must not contain control characters` };
    }
    if (seen.has(trimmed)) {
      return { ok: false, message: `${field} must not contain duplicates` };
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return { ok: true, value: normalized };
}
