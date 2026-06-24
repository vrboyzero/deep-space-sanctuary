/**
 * WorkflowContext — 动态工作流编排 API 类型定义
 *
 * 本文件只定义类型，不含实现。实现由 `belldandy-core` 的
 * `workflow-context-impl.ts` 中的 `createWorkflowContext()` 工厂函数提供。
 *
 * 设计要点：
 * - WorkflowContext 不暴露文件系统或网络原语，沙盒边界在 API 层实现
 * - agent() 内部计算稳定 fingerprint，先查 Journal 缓存，命中则直接返回
 * - parallel() / parallelMap() 信号量控制并发上限，不触发全局 reject
 * - pipeline() 无屏障流水线，各 item 独立流经各 stage，失败 item 跳过后续 stage
 */

import type { DelegationProtocol } from "@belldandy/skills";
import type { AgentLaunchRole } from "./launch-spec.js";

// ─── Agent 调用选项 ───────────────────────────────────────────────────────

export type AgentCallOptions = {
  /** 覆盖当前会话的全局模型设定 */
  model?: string;
  /** Agent 角色 */
  role?: AgentLaunchRole;
  /** 允许的工具族 */
  allowedToolFamilies?: string[];
  /** 最大工具风险等级 */
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  /**
   * 可选的稳定调用键；循环中建议用 stage/index 显式传入，
   * 避免相同 prompt 碰撞。未提供时使用 `${phaseId}/${agentCallIndex}`。
   */
  callKey?: string;
  /** 与指挥模式兼容：支持传入完整 DelegationProtocol */
  delegationProtocol?: DelegationProtocol;
  /** 单次调用超时（毫秒） */
  timeoutMs?: number;
};

// ─── 结构化任务结果 ───────────────────────────────────────────────────────

export type WorkflowTaskResult<T> =
  | {
      ok: true;
      value: T;
      taskId: string;
      cacheHit: boolean;
      tokenCount?: number;
      durationMs?: number;
    }
  | {
      ok: false;
      error: string;
      taskId: string;
      failureKind?: string;
      durationMs?: number;
    };

// ─── Pipeline 阶段 ─────────────────────────────────────────────────────────
//
// pipeline() 让一批数据项像流水线一样连续流经多个 stage，处理快的 item
// 不必等待同批其他 item，可直接进入下一 stage，从而提升整体吞吐。
// 每个 item 独立流经各 stage，无全局屏障；某个 item 在某 stage 失败后，
// 该 item 的后续 stage 跳过，最终返回结构化 WorkflowTaskResult。

export type PipelineStage<In, Out> = (item: In, ctx: WorkflowContext) => Promise<Out>;

// ─── WorkflowContext ──────────────────────────────────────────────────────

export type WorkflowContext = {
  /** 启动一个子 Agent 并等待结果（支持缓存命中跳过） */
  agent(prompt: string, opts?: AgentCallOptions): Promise<string>;

  /** 并发屏障：等待所有任务完成，单个失败返回结构化失败项而非全局抛出 */
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<WorkflowTaskResult<T>>>;

  /** 带并发上限的数据项映射，比 pipeline 更容易验证和恢复 */
  parallelMap<T, U>(
    items: T[],
    mapper: (item: T, index: number, ctx: WorkflowContext) => Promise<U>,
  ): Promise<Array<WorkflowTaskResult<U>>>;

  /**
   * 无屏障流水线：各数据项独立流经各 stage，处理快的 item 可直接进入下一
   * stage，不必等待同批其他 item。某个 item 在某 stage 失败后，该 item 的
   * 后续 stage 跳过，最终在结果数组中返回结构化失败项。
   *
   * 并发上限与 parallelMap 一致，由 WorkflowContext 的 maxConcurrent 控制。
   */
  pipeline<T, U>(items: T[], ...stages: PipelineStage<any, any>[]): Promise<Array<WorkflowTaskResult<U>>>;

  /**
   * 嵌套调用另一个工作流并等待结果。子工作流继承父级的并发上限和代币预算，
   * 使用独立的 journalId 前缀以隔离 journal 记录。
   *
   * 嵌套深度限制 1 层：子工作流内部再次调用 workflow() 会抛错。
   *
   * @param nameOrRef 工作流名称（builtin/file）或 { kind: "builtin"|"file", name, args? }
   * @param args      传给子工作流的静态参数（可选）
   * @returns 子工作流的 output 字符串
   */
  workflow(nameOrRef: string | { kind: "builtin" | "file"; name: string; args?: Record<string, unknown> }, args?: Record<string, unknown>): Promise<string>;

  /** 标记阶段进度（推送到前端进度树） */
  phase(title: string): void;

  /** 推送日志消息到前端 */
  log(msg: string): void;

  /** 工作流启动时传入的静态参数 */
  args: Record<string, unknown>;
};
