/**
 * 任务级 Token 计数器服务
 *
 * 允许 Agent 通过工具调用主动控制 token 统计边界，
 * 从而知道某个特定任务消耗了多少 token。
 */

import type { ActiveCounterSnapshot } from "./conversation.js";

export type { ActiveCounterSnapshot };

export interface CounterResult {
  name: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  totalCostUsd?: number;
}

interface ActiveCounter {
  name: string;
  startTime: number;
  baseInputTokens: number;
  baseOutputTokens: number;
  baseInputCostUsd: number;
  baseOutputCostUsd: number;
}

export class TokenCounterService {
  private readonly counters = new Map<string, ActiveCounter>();
  private globalInputTokens = 0;
  private globalOutputTokens = 0;
  private globalInputCostUsd = 0;
  private globalOutputCostUsd = 0;

  /** 每次模型调用后由 ToolEnabledAgent 调用，更新全局累加器 */
  notifyUsage(inputTokens: number, outputTokens: number, costs?: {
    inputCostUsd?: number;
    outputCostUsd?: number;
  }): void {
    this.globalInputTokens += inputTokens;
    this.globalOutputTokens += outputTokens;
    this.globalInputCostUsd += Math.max(0, Number(costs?.inputCostUsd ?? 0));
    this.globalOutputCostUsd += Math.max(0, Number(costs?.outputCostUsd ?? 0));
  }

  /** 启动一个命名计数器，记录当前全局 token 基准 */
  start(name: string): void {
    if (this.counters.has(name)) {
      throw new Error(`Token counter "${name}" already running`);
    }
    this.counters.set(name, {
      name,
      startTime: Date.now(),
      baseInputTokens: this.globalInputTokens,
      baseOutputTokens: this.globalOutputTokens,
      baseInputCostUsd: this.globalInputCostUsd,
      baseOutputCostUsd: this.globalOutputCostUsd,
    });
  }

  /** 停止计数器，返回从 start 到 stop 之间的 token 差值统计 */
  stop(name: string): CounterResult {
    const counter = this.counters.get(name);
    if (!counter) {
      throw new Error(`Token counter "${name}" not found`);
    }
    const inputTokens = this.globalInputTokens - counter.baseInputTokens;
    const outputTokens = this.globalOutputTokens - counter.baseOutputTokens;
    const inputCostUsd = Math.max(0, this.globalInputCostUsd - counter.baseInputCostUsd);
    const outputCostUsd = Math.max(0, this.globalOutputCostUsd - counter.baseOutputCostUsd);
    this.counters.delete(name);
    return {
      name,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      durationMs: Date.now() - counter.startTime,
      ...(inputCostUsd > 0 ? { inputCostUsd } : {}),
      ...(outputCostUsd > 0 ? { outputCostUsd } : {}),
      ...(inputCostUsd > 0 || outputCostUsd > 0 ? { totalCostUsd: inputCostUsd + outputCostUsd } : {}),
    };
  }

  /** 列出所有活跃计数器名称 */
  list(): string[] {
    return Array.from(this.counters.keys());
  }

  /** run 结束时自动清理未关闭的计数器，返回泄漏的计数器名称列表 */
  cleanup(): string[] {
    const leaked = this.list();
    this.counters.clear();
    return leaked;
  }

  /** 导出当前所有活跃计数器的快照（用于跨 run 持久化） */
  getSnapshots(): ActiveCounterSnapshot[] {
    return Array.from(this.counters.values()).map(c => ({
      name: c.name,
      startTime: c.startTime,
      baseInputTokens: c.baseInputTokens,
      baseOutputTokens: c.baseOutputTokens,
      savedGlobalInputTokens: this.globalInputTokens,
      savedGlobalOutputTokens: this.globalOutputTokens,
      savedGlobalInputCostUsd: this.globalInputCostUsd,
      savedGlobalOutputCostUsd: this.globalOutputCostUsd,
    }));
  }

  /** 从快照恢复活跃计数器（跨 run 恢复时调用） */
  restoreFromSnapshots(snapshots: ActiveCounterSnapshot[]): void {
    for (const s of snapshots) {
      if (!this.counters.has(s.name)) {
        this.counters.set(s.name, {
          name: s.name,
          startTime: s.startTime,
          // 将 base 调整为相对于新 run 全局累加器（从 0 开始）的偏移量。
          // 公式：新 base = 原始 base - 快照时全局值 = -(上一 run 内已累计量)
          // 这样 stop() 时：新run累计 - 新base = 新run累计 + 上一run累计 = 跨run总量
          baseInputTokens: s.baseInputTokens - s.savedGlobalInputTokens,
          baseOutputTokens: s.baseOutputTokens - s.savedGlobalOutputTokens,
          baseInputCostUsd: (s.baseInputCostUsd ?? 0) - (s.savedGlobalInputCostUsd ?? 0),
          baseOutputCostUsd: (s.baseOutputCostUsd ?? 0) - (s.savedGlobalOutputCostUsd ?? 0),
        });
      }
    }
  }
}
