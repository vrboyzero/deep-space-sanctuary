/**
 * 钩子执行器
 *
 * 提供钩子执行的核心逻辑，支持：
 * - 并行执行（fire-and-forget）
 * - 顺序执行（可修改返回值）
 * - 同步执行（tool_result_persist 专用）
 * - 优先级排序
 * - 错误处理选项
 */

import type {
  HookName,
  HookRegistration,
  HookRegistry,
  HookHandlerMap,
  HookAgentContext,
  HookMessageContext,
  HookToolContext,
  HookToolResultPersistContext,
  HookSessionContext,
  HookGatewayContext,
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  AgentEndEvent,
  BeforeCompactionEvent,
  AfterCompactionEvent,
  MessageReceivedEvent,
  MessageSendingEvent,
  MessageSendingResult,
  MessageSentEvent,
  BeforeToolCallEvent,
  BeforeToolCallResult,
  AfterToolCallEvent,
  ToolResultPersistEvent,
  ToolResultPersistResult,
  SessionStartEvent,
  SessionEndEvent,
  GatewayStartEvent,
  GatewayStopEvent,
} from "./hooks.js";
import {
  HOOK_FAILURE_POLICIES,
  listHookFailurePolicies,
  type HookFailurePolicyDescriptor,
} from "./hook-failure-policy.js";

export { HOOK_FAILURE_POLICIES } from "./hook-failure-policy.js";

// ============================================================================
// 日志接口
// ============================================================================

/**
 * 钩子运行器日志接口
 */
export interface HookRunnerLogger {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
  error: (message: string) => void;
}

// ============================================================================
// 运行器选项
// ============================================================================

/**
 * 钩子运行器选项
 */
export interface HookRunnerOptions {
  /** 日志记录器 */
  logger?: HookRunnerLogger;
  /** 是否捕获错误（true: 记录错误但不抛出；false: 抛出错误） */
  catchErrors?: boolean;
}

export interface HookRunnerDiagnostics {
  catchErrors: boolean;
  policies: HookFailurePolicyDescriptor[];
}

// ============================================================================
// 钩子运行器
// ============================================================================

/**
 * 创建钩子运行器
 *
 * @param registry 钩子注册表
 * @param options 运行器选项
 */
export function createHookRunner(registry: HookRegistry, options: HookRunnerOptions = {}) {
  const logger = options.logger;
  const catchErrors = options.catchErrors ?? true;

  // ==========================================================================
  // 通用执行器
  // ==========================================================================

  /**
   * 并行执行无返回值钩子（fire-and-forget）
   *
   * 所有处理函数并行执行，适用于日志、审计等场景。
   */
  async function runVoidHook<K extends HookName>(
    hookName: K,
    event: Parameters<HookHandlerMap[K]>[0],
    ctx: Parameters<HookHandlerMap[K]>[1],
  ): Promise<void> {
    const hooks = registry.getHooks(hookName);
    if (hooks.length === 0) return;

    logger?.debug?.(`[hooks] 执行 ${hookName}（${hooks.length} 个处理器，并行）`);

    const promises = hooks.map(async (hook) => {
      try {
        await (hook.handler as (event: unknown, ctx: unknown) => Promise<void>)(event, ctx);
      } catch (err) {
        const msg = `[hooks] ${hookName} 处理器（来源: ${hook.source}）执行失败: ${String(err)}`;
        if (catchErrors) {
          logger?.error(msg);
        } else {
          throw new Error(msg);
        }
      }
    });

    await Promise.all(promises);
  }

  /**
   * 顺序执行可修改钩子
   *
   * 处理函数按优先级顺序执行，每个处理函数的返回值可以被下一个处理函数使用。
   *
   * @param mergeResults 结果合并函数（用于累积多个处理器的结果）
   */
  async function runModifyingHook<K extends HookName, TResult>(
    hookName: K,
    event: Parameters<HookHandlerMap[K]>[0],
    ctx: Parameters<HookHandlerMap[K]>[1],
    mergeResults?: (accumulated: TResult | undefined, next: TResult) => TResult,
    onHandlerFailure?: (hook: HookRegistration<K>) => void,
  ): Promise<TResult | undefined> {
    const hooks = registry.getHooks(hookName);
    if (hooks.length === 0) return undefined;

    logger?.debug?.(`[hooks] 执行 ${hookName}（${hooks.length} 个处理器，顺序）`);

    let result: TResult | undefined;

    for (const hook of hooks) {
      try {
        const handlerResult = await (hook.handler as (event: unknown, ctx: unknown) => Promise<TResult>)(
          event,
          ctx,
        );

        if (handlerResult !== undefined && handlerResult !== null) {
          if (mergeResults && result !== undefined) {
            result = mergeResults(result, handlerResult);
          } else {
            result = handlerResult;
          }
        }
      } catch (err) {
        const msg = `[hooks] ${hookName} 处理器（来源: ${hook.source}）执行失败: ${String(err)}`;
        if (catchErrors) {
          logger?.error(msg);
          onHandlerFailure?.(hook);
        } else {
          throw new Error(msg);
        }
      }
    }

    return result;
  }

  /**
   * 同步执行钩子（tool_result_persist 专用）
   *
   * 在热路径中同步执行，不支持异步处理器。
   * 如果处理器返回 Promise，会发出警告并忽略结果。
   */
  function runSyncHook<TEvent, TContext, TResult>(
    hookName: HookName,
    hooks: HookRegistration[],
    event: TEvent,
    ctx: TContext,
  ): TResult | undefined {
    if (hooks.length === 0) return undefined;

    logger?.debug?.(`[hooks] 执行 ${hookName}（${hooks.length} 个处理器，同步）`);

    let current = event;

    for (const hook of hooks) {
      try {
        const out = (hook.handler as (event: TEvent, ctx: TContext) => TResult | void | Promise<unknown>)(
          current,
          ctx,
        );

        // 检查是否意外返回了 Promise（同步钩子不支持异步）
        if (out && typeof (out as { then?: unknown }).then === "function") {
          const msg =
            `[hooks] ${hookName} 处理器（来源: ${hook.source}）返回了 Promise；` +
            `此钩子仅支持同步执行，结果已被忽略。`;
          if (catchErrors) {
            logger?.warn?.(msg);
            continue;
          }
          throw new Error(msg);
        }

        const next = (out as TResult | undefined);
        if (next !== undefined && next !== null) {
          current = next as unknown as TEvent;
        }
      } catch (err) {
        const msg = `[hooks] ${hookName} 处理器（来源: ${hook.source}）执行失败: ${String(err)}`;
        if (catchErrors) {
          logger?.error(msg);
        } else {
          throw new Error(msg);
        }
      }
    }

    return current as unknown as TResult;
  }

  // ==========================================================================
  // Agent 钩子
  // ==========================================================================

  /**
   * 执行 before_agent_start 钩子
   *
   * 允许插件注入系统提示词或上下文。
   * 顺序执行，合并 systemPrompt 和 prependContext。
   */
  async function runBeforeAgentStart(
    event: BeforeAgentStartEvent,
    ctx: HookAgentContext,
  ): Promise<BeforeAgentStartResult | undefined> {
    return runModifyingHook<"before_agent_start", BeforeAgentStartResult>(
      "before_agent_start",
      event,
      ctx,
      (acc, next) => ({
        systemPrompt: next.systemPrompt ?? acc?.systemPrompt,
        prependContext:
          acc?.prependContext && next.prependContext
            ? `${acc.prependContext}\n\n${next.prependContext}`
            : (next.prependContext ?? acc?.prependContext),
        deltas:
          acc?.deltas && next.deltas
            ? [...acc.deltas, ...next.deltas]
            : (next.deltas ?? acc?.deltas),
      }),
    );
  }

  /**
   * 执行 agent_end 钩子
   *
   * 允许插件分析完成的对话。
   * 并行执行（fire-and-forget）。
   */
  async function runAgentEnd(
    event: AgentEndEvent,
    ctx: HookAgentContext,
  ): Promise<void> {
    return runVoidHook("agent_end", event, ctx);
  }

  /**
   * 执行 before_compaction 钩子
   */
  async function runBeforeCompaction(
    event: BeforeCompactionEvent,
    ctx: HookAgentContext,
  ): Promise<void> {
    return runVoidHook("before_compaction", event, ctx);
  }

  /**
   * 执行 after_compaction 钩子
   */
  async function runAfterCompaction(
    event: AfterCompactionEvent,
    ctx: HookAgentContext,
  ): Promise<void> {
    return runVoidHook("after_compaction", event, ctx);
  }

  // ==========================================================================
  // 消息钩子
  // ==========================================================================

  /**
   * 执行 message_received 钩子
   *
   * 并行执行（fire-and-forget）。
   */
  async function runMessageReceived(
    event: MessageReceivedEvent,
    ctx: HookMessageContext,
  ): Promise<void> {
    return runVoidHook("message_received", event, ctx);
  }

  /**
   * 执行 message_sending 钩子
   *
   * 允许插件修改或取消即将发送的消息。
   * 顺序执行。
   */
  async function runMessageSending(
    event: MessageSendingEvent,
    ctx: HookMessageContext,
  ): Promise<MessageSendingResult | undefined> {
    return runModifyingHook<"message_sending", MessageSendingResult>(
      "message_sending",
      event,
      ctx,
      (acc, next) => ({
        content: next.content ?? acc?.content,
        cancel: next.cancel ?? acc?.cancel,
      }),
    );
  }

  /**
   * 执行 message_sent 钩子
   *
   * 并行执行（fire-and-forget）。
   */
  async function runMessageSent(
    event: MessageSentEvent,
    ctx: HookMessageContext,
  ): Promise<void> {
    return runVoidHook("message_sent", event, ctx);
  }

  // ==========================================================================
  // 工具钩子
  // ==========================================================================

  /**
   * 执行 before_tool_call 钩子
   *
   * 允许插件修改或阻止工具调用。
   * 顺序执行。
   */
  async function runBeforeToolCall(
    event: BeforeToolCallEvent,
    ctx: HookToolContext,
  ): Promise<BeforeToolCallResult | undefined> {
    let failedClosed = false;
    const result = await runModifyingHook<"before_tool_call", BeforeToolCallResult>(
      "before_tool_call",
      event,
      ctx,
      (acc, next) => ({
        params: next.params ?? acc?.params,
        block: next.block ?? acc?.block,
        blockReason: next.blockReason ?? acc?.blockReason,
        skipExecution: next.skipExecution ?? acc?.skipExecution,
        syntheticResult: next.syntheticResult ?? acc?.syntheticResult,
      }),
      () => {
        failedClosed = HOOK_FAILURE_POLICIES.before_tool_call === "fail_closed";
      },
    );
    if (!failedClosed) return result;

    // 在全部 owner 执行后锁存阻断，后续 Hook 返回 block=false 也不能解除安全失败。
    return {
      ...(result ?? {}),
      block: true,
      blockReason: result?.block === true && result.blockReason
        ? result.blockReason
        : "Hook handler failed; tool call blocked by fail-closed policy.",
    };
  }

  /**
   * 执行 after_tool_call 钩子
   *
   * 并行执行（fire-and-forget）。
   */
  async function runAfterToolCall(
    event: AfterToolCallEvent,
    ctx: HookToolContext,
  ): Promise<void> {
    return runVoidHook("after_tool_call", event, ctx);
  }

  /**
   * 执行 tool_result_persist 钩子（同步）
   *
   * 允许插件修改即将持久化到 transcript 的工具结果。
   * 同步执行（在热路径中使用）。
   */
  function runToolResultPersist(
    event: ToolResultPersistEvent,
    ctx: HookToolResultPersistContext,
  ): ToolResultPersistResult | undefined {
    const hooks = registry.getHooks("tool_result_persist");
    if (hooks.length === 0) return undefined;

    let current = event.message;

    for (const hook of hooks) {
      try {
        const out = (hook.handler as (
          event: ToolResultPersistEvent,
          ctx: HookToolResultPersistContext,
        ) => ToolResultPersistResult | void)({ ...event, message: current }, ctx);

        // 检查是否意外返回了 Promise
        if (out && typeof (out as { then?: unknown }).then === "function") {
          const msg =
            `[hooks] tool_result_persist 处理器（来源: ${hook.source}）返回了 Promise；` +
            `此钩子仅支持同步执行，结果已被忽略。`;
          if (catchErrors) {
            logger?.warn?.(msg);
            continue;
          }
          throw new Error(msg);
        }

        const next = (out as ToolResultPersistResult | undefined)?.message;
        if (next) current = next;
      } catch (err) {
        const msg = `[hooks] tool_result_persist 处理器（来源: ${hook.source}）执行失败: ${String(err)}`;
        if (catchErrors) {
          logger?.error(msg);
        } else {
          throw new Error(msg);
        }
      }
    }

    return { message: current };
  }

  // ==========================================================================
  // 会话钩子
  // ==========================================================================

  /**
   * 执行 session_start 钩子
   *
   * 并行执行（fire-and-forget）。
   */
  async function runSessionStart(
    event: SessionStartEvent,
    ctx: HookSessionContext,
  ): Promise<void> {
    return runVoidHook("session_start", event, ctx);
  }

  /**
   * 执行 session_end 钩子
   *
   * 并行执行（fire-and-forget）。
   */
  async function runSessionEnd(
    event: SessionEndEvent,
    ctx: HookSessionContext,
  ): Promise<void> {
    return runVoidHook("session_end", event, ctx);
  }

  // ==========================================================================
  // 网关钩子
  // ==========================================================================

  /**
   * 执行 gateway_start 钩子
   *
   * 并行执行（fire-and-forget）。
   */
  async function runGatewayStart(
    event: GatewayStartEvent,
    ctx: HookGatewayContext,
  ): Promise<void> {
    return runVoidHook("gateway_start", event, ctx);
  }

  /**
   * 执行 gateway_stop 钩子
   *
   * 并行执行（fire-and-forget）。
   */
  async function runGatewayStop(
    event: GatewayStopEvent,
    ctx: HookGatewayContext,
  ): Promise<void> {
    return runVoidHook("gateway_stop", event, ctx);
  }

  // ==========================================================================
  // 工具函数
  // ==========================================================================

  /**
   * 检查是否有指定名称的钩子
   */
  function hasHooks(hookName: HookName): boolean {
    return registry.hasHooks(hookName);
  }

  /**
   * 获取指定名称的钩子数量
   */
  function getHookCount(hookName: HookName): number {
    return registry.getHookCount(hookName);
  }

  /** 返回只含执行模式和失败策略的静态诊断，不保留 Hook 调用内容。 */
  function getDiagnostics(): HookRunnerDiagnostics {
    return {
      catchErrors,
      policies: listHookFailurePolicies(),
    };
  }

  return {
    // Agent 钩子
    runBeforeAgentStart,
    runAgentEnd,
    runBeforeCompaction,
    runAfterCompaction,
    // 消息钩子
    runMessageReceived,
    runMessageSending,
    runMessageSent,
    // 工具钩子
    runBeforeToolCall,
    runAfterToolCall,
    runToolResultPersist,
    // 会话钩子
    runSessionStart,
    runSessionEnd,
    // 网关钩子
    runGatewayStart,
    runGatewayStop,
    // 工具函数
    hasHooks,
    getHookCount,
    getDiagnostics,
  };
}

/**
 * 钩子运行器类型
 */
export type HookRunner = ReturnType<typeof createHookRunner>;
