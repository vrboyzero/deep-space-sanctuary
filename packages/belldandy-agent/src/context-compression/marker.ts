/**
 * 统一 marker 格式与解析（Phase 2）
 *
 * 设计依据：SS借鉴RH项目优化项实施计划.md §4.3 / §7.2
 *
 * 单协议原则：所有"把大块上下文替换成紧凑标记"的实现都归并到这套 marker。
 * cold resume prune 只是 reference protocol 的一种触发策略，不另起 marker。
 *
 * Marker 格式（单行 header，置于压缩内容前）：
 *
 *   [compressed-ref id=<refId> strategy=<strategy> source=<sourceName> retrievable=<yes|no>]
 *   <压缩后的内容>
 *
 * 字段说明：
 * - id: 引用 ID，对应 reference store 中的 refId
 * - strategy: 压缩策略名（如 log-output-extractive）
 * - source: 来源工具/附件名
 * - retrievable: yes 表示原文可在当前 runtime reference store 回取；no 表示已失效（冷恢复后或已被 prune）
 *
 * 兼容性：
 * - 仍能识别 Phase 1 的旧标记 `[compressed tool output]`，视为无引用的纯压缩
 * - 仍能识别 microcompact 的 `[old tool output cleared]` / `[old tool error summary preserved]`
 */

import type { ReferenceStatus } from "./types.js";

/** Marker header 前缀，用于快速检测 */
export const COMPRESSION_MARKER_PREFIX = "[compressed-ref";
/** Phase 1 旧标记前缀 */
export const LEGACY_MARKER_PREFIX = "[compressed tool output]";
/** microcompact 标记前缀 */
export const MICROCOMPACT_CLEARED_PREFIX = "[old tool output cleared]";
export const MICROCOMPACT_ERROR_PREFIX = "[old tool error summary preserved]";

/** Marker 解析结果 */
export type ParsedCompressionMarker = {
  refId: string;
  strategy: string;
  source: string;
  /** 是否可回取原文 */
  retrievable: boolean;
  /** marker 行在整个内容中的偏移 */
  headerLineEnd: number;
};

const MARKER_RE = /^\[compressed-ref\s+id=(\S+)\s+strategy=(\S+)(?:\s+source=(\S+))?(?:\s+retrievable=(yes|no))?\]\s*$/;

/** 判断内容是否以统一 marker 开头 */
export function hasCompressionMarker(content: string): boolean {
  if (typeof content !== "string") return false;
  return content.startsWith(COMPRESSION_MARKER_PREFIX);
}

/** 判断内容是否以 Phase 1 旧标记开头 */
export function hasLegacyCompressionMarker(content: string): boolean {
  if (typeof content !== "string") return false;
  return content.startsWith(LEGACY_MARKER_PREFIX);
}

/** 判断内容是否已被任何压缩层标记（含 microcompact） */
export function isAnyCompactedContent(content: string): boolean {
  if (typeof content !== "string") return false;
  return (
    content.startsWith(COMPRESSION_MARKER_PREFIX) ||
    content.startsWith(LEGACY_MARKER_PREFIX) ||
    content.startsWith(MICROCOMPACT_CLEARED_PREFIX) ||
    content.startsWith(MICROCOMPACT_ERROR_PREFIX)
  );
}

/** 从内容中解析 marker header（仅检查首行） */
export function parseCompressionMarker(content: string): ParsedCompressionMarker | undefined {
  if (!content.startsWith(COMPRESSION_MARKER_PREFIX)) return undefined;
  const newlineIdx = content.indexOf("\n");
  const headerLine = newlineIdx >= 0 ? content.slice(0, newlineIdx) : content;
  const match = headerLine.match(MARKER_RE);
  if (!match) return undefined;
  const [, refId, strategy, source = "unknown", retrievable = "yes"] = match;
  return {
    refId,
    strategy,
    source,
    retrievable: retrievable === "yes",
    headerLineEnd: newlineIdx >= 0 ? newlineIdx + 1 : content.length,
  };
}

/** 构建 marker header 行 */
export function buildCompressionMarkerHeader(input: {
  refId: string;
  strategy: string;
  source?: string;
  retrievable?: boolean;
}): string {
  const source = input.source ?? "unknown";
  const retrievable = input.retrievable === false ? "no" : "yes";
  return `[compressed-ref id=${input.refId} strategy=${input.strategy} source=${source} retrievable=${retrievable}]`;
}

/** 将压缩结果包装为带 marker 的完整内容 */
export function wrapWithMarker(input: {
  refId: string;
  strategy: string;
  source?: string;
  retrievable?: boolean;
  compressedContent: string;
}): string {
  const header = buildCompressionMarkerHeader(input);
  return `${header}\n${input.compressedContent}`;
}

/**
 * 将 marker 中的 retrievable 状态改写。
 * 用于冷恢复裁剪：当 reference store 中找不到 refId 时，改写为 retrievable=no。
 *
 * 若内容不是统一 marker，原样返回。
 */
export function rewriteMarkerRetrievable(content: string, retrievable: boolean): string {
  const parsed = parseCompressionMarker(content);
  if (!parsed) return content;
  const body = content.slice(parsed.headerLineEnd);
  const header = buildCompressionMarkerHeader({
    refId: parsed.refId,
    strategy: parsed.strategy,
    source: parsed.source,
    retrievable,
  });
  return `${header}\n${body}`;
}

/** 将 ReferenceStatus 映射为 retrievable 布尔 */
export function statusToRetrievable(status: ReferenceStatus | undefined): boolean {
  return status === "active";
}
