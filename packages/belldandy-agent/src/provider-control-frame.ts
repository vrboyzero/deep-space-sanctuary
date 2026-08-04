const CONTROL_FRAME_TAGS = [
  "</｜｜DSML｜｜parameter>",
  "</｜｜DSML｜｜invoke>",
  "</｜｜DSML｜｜tool_calls>",
] as const;

const CONTROL_FRAME_START = CONTROL_FRAME_TAGS[0];
const MAX_CONTROL_FRAME_CHARS = 256;

type ControlFrameMatch = "complete" | "prefix" | "invalid";

/**
 * 仅缓冲可能位于响应末尾的 Provider 帧。只有完整 JSON 之后的精确控制帧会在
 * 结束时丢弃；其余输入均按原字符返回，避免静默改写普通正文或不完整帧。
 */
export class ProviderControlFrameBoundary {
  private pending = "";

  push(text: string): string {
    if (!text) return "";
    const combined = this.pending + text;
    this.pending = "";
    const candidateStart = findCandidateStart(combined);
    if (candidateStart === undefined) return combined;
    this.pending = combined.slice(candidateStart);
    return combined.slice(0, candidateStart);
  }

  finish(visiblePrefix: string): string {
    const pending = this.pending;
    this.pending = "";
    if (matchControlFrame(pending) === "complete" && isCompleteJson(visiblePrefix)) {
      return "";
    }
    return pending;
  }
}

export function filterProviderControlFrameSuffix(text: string): string {
  const boundary = new ProviderControlFrameBoundary();
  const visible = boundary.push(text);
  return visible + boundary.finish(visible);
}

function findCandidateStart(text: string): number | undefined {
  let fullStart = text.lastIndexOf(CONTROL_FRAME_START);
  while (fullStart >= 0) {
    const candidate = text.slice(fullStart);
    if (
      candidate.length <= MAX_CONTROL_FRAME_CHARS
      && matchControlFrame(candidate) !== "invalid"
    ) {
      return fullStart;
    }
    fullStart = text.lastIndexOf(CONTROL_FRAME_START, fullStart - 1);
  }

  const maxPrefixLength = Math.min(text.length, CONTROL_FRAME_START.length - 1);
  for (let length = maxPrefixLength; length > 0; length -= 1) {
    if (CONTROL_FRAME_START.startsWith(text.slice(-length))) {
      return text.length - length;
    }
  }
  return undefined;
}

function matchControlFrame(value: string): ControlFrameMatch {
  if (!value || value.length > MAX_CONTROL_FRAME_CHARS) return "invalid";
  let offset = 0;

  for (let index = 0; index < CONTROL_FRAME_TAGS.length; index += 1) {
    const tag = CONTROL_FRAME_TAGS[index];
    const remaining = value.slice(offset);
    if (remaining.length < tag.length && tag.startsWith(remaining)) return "prefix";
    if (!value.startsWith(tag, offset)) return "invalid";
    offset += tag.length;

    while (offset < value.length && isFrameWhitespace(value[offset])) offset += 1;
    if (index < CONTROL_FRAME_TAGS.length - 1 && offset === value.length) return "prefix";
  }

  return offset === value.length ? "complete" : "invalid";
}

function isFrameWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function isCompleteJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (tryParseJson(trimmed)) return true;

  const fences = trimmed.match(/```/g);
  if (fences?.length !== 2) return false;
  const match = trimmed.match(/(?:^|\r?\n)```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
  return match ? tryParseJson(match[1]?.trim() ?? "") : false;
}

function tryParseJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
