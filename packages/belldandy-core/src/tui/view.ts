import stripAnsi from "strip-ansi";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

export function toVisibleLines(value: string, width: number, maxLines: number): string[] {
  return wrapVisibleLines(value, width, maxLines).slice(-Math.max(0, Math.trunc(maxLines)));
}

export function toLeadingVisibleLines(value: string, width: number, maxLines: number): string[] {
  return wrapVisibleLines(value, width, maxLines).slice(0, Math.max(0, Math.trunc(maxLines)));
}

function wrapVisibleLines(value: string, width: number, maxLines: number): string[] {
  const safeWidth = Math.max(1, Math.trunc(width));
  const safeMaxLines = Math.max(0, Math.trunc(maxLines));
  if (safeMaxLines === 0) return [];
  const sanitized = stripAnsi(String(value ?? ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  const lines = wrapAnsi(sanitized, safeWidth, { hard: true, trim: false }).split("\n");
  return lines;
}

export function formatTuiTimestamp(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return new Date(value).toLocaleString();
}

export function truncateTuiIdentifier(value: string, maxChars = 48): string {
  const normalized = stripAnsi(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const maxWidth = Math.max(1, Math.trunc(maxChars));
  if (stringWidth(normalized) <= maxWidth) return normalized;
  if (maxWidth <= 3) return ".".repeat(maxWidth);
  const contentWidth = maxWidth - 3;
  let prefix = "";
  for (const character of normalized) {
    const candidate = `${prefix}${character}`;
    if (stringWidth(candidate) > contentWidth) break;
    prefix = candidate;
  }
  return `${prefix}...`;
}
