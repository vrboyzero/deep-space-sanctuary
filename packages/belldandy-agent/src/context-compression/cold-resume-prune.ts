/**
 * 冷恢复裁剪（Phase 2）
 *
 * 设计依据：SS借鉴RH项目优化项实施计划.md §7.2 / §9 Phase 2
 *
 * 职责：
 * - 扫描 messages 中的统一 marker
 * - 对每个 marker 的 refId，检查 reference store 是否可回取
 * - 不可回取的，改写 marker 为 retrievable=no
 * - 已失效的（store 中有但 status=invalidated/expired），同步改写
 *
 * 单协议原则：cold resume prune 只是 reference protocol 的一种触发策略，
 * 不另起 marker，不删除压缩内容，只更新 marker 状态。
 *
 * prune-before-summarize：在 compactInLoop 之前调用，确保 summarizer 看到的 marker 状态一致。
 */

import {
  parseCompressionMarker,
  rewriteMarkerRetrievable,
  hasCompressionMarker,
} from "./marker.js";
import type { CompressionReferenceStore, ReferenceStatus } from "./types.js";

/** 最小化的 message 形状，避免与具体运行时类型耦合 */
type PrunableMessage = {
  role: string;
  content?: unknown;
};

export type ColdResumePruneResult = {
  /** 扫描到的 marker 总数 */
  scannedMarkers: number;
  /** 改写为 retrievable=no 的数量 */
  invalidatedMarkers: number;
  /** 已经是 retrievable=no 的数量 */
  alreadyInvalidMarkers: number;
  /** 仍可回取的数量 */
  retrievableMarkers: number;
  /** 被改写内容的 message 索引列表 */
  mutatedMessageIndices: number[];
};

/**
 * 对 messages 做冷恢复裁剪。
 *
 * @param messages 要扫描的消息数组（会原地改写 content）
 * @param store 引用存储；若为空则所有 marker 都视为不可回取
 */
export function coldResumePruneMessages(
  messages: PrunableMessage[],
  store: CompressionReferenceStore | undefined,
): ColdResumePruneResult {
  let scannedMarkers = 0;
  let invalidatedMarkers = 0;
  let alreadyInvalidMarkers = 0;
  let retrievableMarkers = 0;
  const mutatedMessageIndices: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg.content !== "string") continue;
    const content = msg.content;
    if (!hasCompressionMarker(content)) continue;

    const parsed = parseCompressionMarker(content);
    if (!parsed) continue;

    scannedMarkers++;

    let currentStatus: ReferenceStatus | undefined;
    let found = false;
    if (store) {
      const result = store.retrieve(parsed.refId);
      found = result.found;
      currentStatus = result.status;
    }

    const shouldBeRetrievable = found && currentStatus === "active";

    if (shouldBeRetrievable) {
      if (!parsed.retrievable) {
        // store 有且 active，但 marker 标记为 no，修正为 yes
        msg.content = rewriteMarkerRetrievable(content, true);
        mutatedMessageIndices.push(i);
      }
      retrievableMarkers++;
      continue;
    }

    if (!parsed.retrievable) {
      alreadyInvalidMarkers++;
      continue;
    }

    // 需要改写为 no
    msg.content = rewriteMarkerRetrievable(content, false);
    invalidatedMarkers++;
    mutatedMessageIndices.push(i);
  }

  return {
    scannedMarkers,
    invalidatedMarkers,
    alreadyInvalidMarkers,
    retrievableMarkers,
    mutatedMessageIndices,
  };
}

/**
 * prune-before-summarize：在 compaction summarize 前先 prune。
 *
 * 确保 summarizer 看到的 marker 状态一致，避免 summarizer 误以为旧 tool result 仍可回取。
 * 同时对 store 中已失效的引用做一次清理。
 */
export function pruneBeforeSummarize(
  messages: PrunableMessage[],
  store: CompressionReferenceStore | undefined,
): ColdResumePruneResult {
  const result = coldResumePruneMessages(messages, store);
  // 顺带清理 store 中已失效的条目
  if (store) {
    store.prune((ref) => ref.status !== "active");
  }
  return result;
}
