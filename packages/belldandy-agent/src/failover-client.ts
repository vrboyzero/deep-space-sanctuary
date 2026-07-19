/**
 * Model Failover Client
 *
 * 封装 HTTP 请求逻辑，支持多 Provider 自动故障转移与错误分类。
 * 参考 OpenClaw 的 model-fallback.ts 实现。
 */

import { readResponseTextBounded } from "@belldandy/protocol";

import { requestModelTransport } from "./model-request-transport.js";

// ─── Types ───────────────────────────────────────────────────────────────

/** 模型 Profile：描述一个可用的 API 端点 */
export type ModelMessageLayout = "single_system_only";

export type ModelProfile = {
    /** 唯一标识（用于日志） */
    id?: string;
    /** 显示名称（用于前端展示） */
    displayName?: string;
    /** API 基础 URL（如 https://api.openai.com） */
    baseUrl: string;
    /** API Key */
    apiKey: string;
    /** 模型名称（如 gpt-4o） */
    model: string;
    /** API 协议（"openai" | "anthropic"），未指定时使用全局配置 */
    protocol?: string;
    /** OpenAI 线路协议（"chat_completions" | "responses"），可按模型覆盖 */
    wireApi?: string;
    /** 单次请求超时（毫秒） */
    requestTimeoutMs?: number;
    /** 同一 profile 的最大重试次数（不含首次请求） */
    maxRetries?: number;
    /** 同一 profile 重试退避基线（毫秒） */
    retryBackoffMs?: number;
    /** 供应商专用代理 URL（可选） */
    proxyUrl?: string;
    /** OpenAI-compatible 思考模式配置（按 provider 原样透传） */
    thinking?: Record<string, unknown>;
    /** OpenAI-compatible 推理强度（透传为 reasoning_effort） */
    reasoningEffort?: string;
    /** OpenAI-compatible / provider-specific options（按 provider 原样透传） */
    options?: Record<string, unknown>;
    /** OpenAI-compatible 请求体顶层透传字段（保留字段会被调用层忽略） */
    requestBodyExtras?: Record<string, unknown>;
    /** 消息布局兼容模式（用于兼容只允许首条 system 的本地模板） */
    messageLayout?: ModelMessageLayout;
};

/** 容灾错误原因分类 */
export type FailoverReason =
    | "rate_limit"   // 429
    | "timeout"      // 超时 / AbortError
    | "server_error" // 5xx
    | "auth"         // 401 / 403
    | "billing"      // 402
    | "unsupported_model" // 当前账户 / 套餐 / 路由不支持该模型
    | "format"       // 400（请求格式错误，不可重试）
    | "unknown";

/** 单次尝试的记录 */
export type FailoverAttempt = {
    profileId: string;
    provider: string;
    model: string;
    error: string;
    reason: FailoverReason;
    status?: number;
    attempt?: number;
    maxAttempts?: number;
    timeoutMs?: number;
    wireApi?: string;
};

/** fetchWithFailover 的返回结果 */
export type FailoverResult = {
    /** 实际使用的 Response */
    response: Response;
    /** 实际使用的 Profile */
    profile: ModelProfile;
    /** 所有失败尝试的记录 */
    attempts: FailoverAttempt[];
    /** 本次 failover 执行的结构化摘要 */
    summary: FailoverExecutionSummary;
};

export type FailoverExecutionStatus = "success" | "non_retryable" | "exhausted" | "aborted";

export type FailoverExecutionStepKind =
    | "cooldown_skip"
    | "same_profile_retry"
    | "cross_profile_fallback"
    | "terminal_fail";

export type FailoverExecutionStep = {
    kind: FailoverExecutionStepKind;
    profileId: string;
    provider: string;
    model: string;
    reason?: FailoverReason | "aborted";
    status?: number;
    attempt?: number;
    maxAttempts?: number;
    timeoutMs?: number;
    wireApi?: string;
    error?: string;
    waitMs?: number;
};

export type FailoverExecutionSummary = {
    configuredProfiles: Array<{
        profileId: string;
        provider: string;
        model: string;
        protocol?: string;
        wireApi?: string;
    }>;
    finalStatus: FailoverExecutionStatus;
    finalProfileId?: string;
    finalProvider?: string;
    finalModel?: string;
    finalReason?: FailoverReason | "aborted";
    finalStatusCode?: number;
    requestCount: number;
    failedStageCount: number;
    degraded: boolean;
    stepCounts: {
        cooldownSkips: number;
        sameProfileRetries: number;
        crossProfileFallbacks: number;
        terminalFailures: number;
    };
    reasonCounts: Partial<Record<FailoverReason, number>>;
    steps: FailoverExecutionStep[];
    startedAt: number;
    updatedAt: number;
    durationMs: number;
};

export class FailoverExhaustedError extends Error {
    readonly attempts: FailoverAttempt[];
    readonly summary: FailoverExecutionSummary;

    constructor(message: string, attempts: FailoverAttempt[], summary: FailoverExecutionSummary) {
        super(message);
        this.name = "FailoverExhaustedError";
        this.attempts = attempts;
        this.summary = summary;
    }
}

/** 可选的日志接口 */
export type FailoverLogger = {
    debug?: (module: string, msg: string, data?: unknown) => void;
    info(module: string, msg: string, data?: unknown): void;
    warn(module: string, msg: string, data?: unknown): void;
    error(module: string, msg: string, data?: unknown): void;
};

function normalizeProfileDedupString(value: string | undefined): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function buildProfileDedupKey(profile: Pick<ModelProfile, "baseUrl" | "apiKey" | "model" | "wireApi" | "protocol">): string {
    return [
        normalizeProfileDedupString(profile.baseUrl)?.replace(/\/+$/, "").toLowerCase() ?? "",
        normalizeProfileDedupString(profile.apiKey) ?? "",
        normalizeProfileDedupString(profile.model)?.toLowerCase() ?? "",
        normalizeProfileDedupString(profile.wireApi)?.toLowerCase() ?? "",
        normalizeProfileDedupString(profile.protocol)?.toLowerCase() ?? "",
    ].join("::");
}

function stripUtf8Bom(raw: string): string {
    return raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
}

const UNSUPPORTED_MODEL_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const UNSUPPORTED_MODEL_PATTERNS = [
    /token\s*plan\s*not\s*support\s*model/i,
    /plan\s*not\s*support\s*model/i,
    /not\s*support\s*model/i,
    /unsupported\s*model/i,
    /model\s+.+\s+not\s+(?:supported|available)/i,
    /does\s+not\s+support\s+model/i,
    /当前.*不支持.*模型/u,
    /套餐.*不支持.*模型/u,
    /模型.*不可用/u,
];

export function isUnsupportedModelErrorText(errorText?: string): boolean {
    if (typeof errorText !== "string") return false;
    const normalized = errorText.trim();
    if (!normalized) return false;
    return UNSUPPORTED_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

// ─── 错误分类函数 ─────────────────────────────────────────────────────────

/**
 * 根据 HTTP 状态码判断错误是否可重试（应触发 failover）。
 * - unsupported model / unsupported plan → 切换到下一个 profile，但不重试同 profile
 * - 429 / 5xx / 408 → 可重试
 * - 401 / 402 / 403 → 可重试（换 Key / Provider 可能解决）
 * - 400 → 不可重试（请求格式问题，换 Provider 也没用）
 */
export function classifyFailoverReason(status: number, errorText?: string): FailoverReason {
    if (isUnsupportedModelErrorText(errorText)) return "unsupported_model";
    if (status === 429) return "rate_limit";
    if (status === 408) return "timeout";
    if (status === 401 || status === 403) return "auth";
    if (status === 402) return "billing";
    if (status === 400) return "format";
    if (status >= 500) return "server_error";
    return "unknown";
}

/** 判断该错误原因是否应触发 failover */
export function isRetryableReason(reason: FailoverReason): boolean {
    // 400 (format) 不可重试——请求本身有问题，换 Provider 也无效
    return reason !== "format";
}

export function resolveFailoverCooldownMs(
    reason: FailoverReason,
    opts?: {
        retryAfterMs?: number;
        defaultCooldownMs?: number;
    },
): number | undefined {
    if (reason === "rate_limit") {
        return opts?.retryAfterMs ?? opts?.defaultCooldownMs;
    }
    if (reason === "billing") {
        return Math.max(opts?.defaultCooldownMs ?? 0, 600_000);
    }
    if (reason === "unsupported_model") {
        return Math.max(opts?.defaultCooldownMs ?? 0, UNSUPPORTED_MODEL_COOLDOWN_MS);
    }
    return opts?.defaultCooldownMs;
}

// ─── Cooldown 管理 ────────────────────────────────────────────────────────

/** 简单的内存级 Cooldown 管理器（支持指数退避） */
class CooldownManager {
    private readonly cooldowns = new Map<string, number>();
    private readonly errorCounts = new Map<string, { count: number; lastFailure: number }>();

    /** 默认冷却 60 秒 */
    private readonly defaultCooldownMs: number;
    /** 错误计数重置窗口（默认 24 小时） */
    private readonly errorWindowMs: number;

    constructor(cooldownMs = 60_000, errorWindowMs = 24 * 60 * 60 * 1000) {
        this.defaultCooldownMs = cooldownMs;
        this.errorWindowMs = errorWindowMs;
    }

    /**
     * 将 profile 标记为冷却中。
     * 如果提供了 durationMs 则使用该值（如 Retry-After），
     * 否则使用指数退避：60s * 5^(errorCount-1)，上限 1 小时。
     */
    mark(profileId: string, durationMs?: number): void {
        // 更新错误计数
        const now = Date.now();
        const existing = this.errorCounts.get(profileId);
        let errorCount: number;

        if (existing && (now - existing.lastFailure) < this.errorWindowMs) {
            errorCount = existing.count + 1;
        } else {
            errorCount = 1;
        }
        this.errorCounts.set(profileId, { count: errorCount, lastFailure: now });

        // 计算冷却时间
        let cooldownMs: number;
        if (durationMs !== undefined) {
            cooldownMs = durationMs;
        } else {
            // 指数退避：60s * 5^(n-1)，上限 1 小时
            cooldownMs = Math.min(
                this.defaultCooldownMs * Math.pow(5, errorCount - 1),
                3_600_000,
            );
        }

        const until = now + cooldownMs;
        this.cooldowns.set(profileId, until);
    }

    /** 检查 profile 是否在冷却中 */
    isInCooldown(profileId: string): boolean {
        return this.peekUntil(profileId) !== undefined;
    }

    peekUntil(profileId: string): number | undefined {
        const until = this.cooldowns.get(profileId);
        if (until === undefined) return undefined;
        if (Date.now() >= until) {
            this.cooldowns.delete(profileId);
            return undefined;
        }
        return until;
    }

    /** 标记 profile 成功，重置错误计数 */
    markSuccess(profileId: string): void {
        this.errorCounts.delete(profileId);
        this.cooldowns.delete(profileId);
    }

    /** 清除指定 profile 的冷却 */
    clear(profileId: string): void {
        this.cooldowns.delete(profileId);
    }

    /** 清除所有冷却 */
    clearAll(): void {
        this.cooldowns.clear();
        this.errorCounts.clear();
    }
}

// ─── FailoverClient ──────────────────────────────────────────────────────

export class FailoverClient {
    private readonly profiles: ModelProfile[];
    private readonly cooldown: CooldownManager;
    private readonly logger?: FailoverLogger;
    private readonly cooldownSkipLogUntil = new Map<string, number>();

    constructor(params: {
        /** 主 Profile（必填） */
        primary: ModelProfile;
        /** 备用 Profiles（可选） */
        fallbacks?: ModelProfile[];
        /** 冷却时间（毫秒），默认 60s */
        cooldownMs?: number;
        /** 启动阶段的预置冷却（毫秒） */
        bootstrapCooldowns?: Record<string, number>;
        /** 日志接口 */
        logger?: FailoverLogger;
    }) {
        // 确保主 Profile 有 id
        const primary: ModelProfile = {
            ...params.primary,
            id: params.primary.id ?? "primary",
        };

        const fallbacks = (params.fallbacks ?? []).map((f, i) => ({
            ...f,
            id: f.id ?? `fallback-${i}`,
        }));
        const seenProfileKeys = new Set<string>();
        const dedupedProfiles: ModelProfile[] = [];
        for (const profile of [primary, ...fallbacks]) {
            const dedupKey = buildProfileDedupKey(profile);
            if (seenProfileKeys.has(dedupKey)) {
                continue;
            }
            seenProfileKeys.add(dedupKey);
            dedupedProfiles.push(profile);
        }

        this.profiles = dedupedProfiles;
        this.cooldown = new CooldownManager(params.cooldownMs ?? 60_000);
        this.logger = params.logger;

        if (params.bootstrapCooldowns) {
            for (const [profileId, durationMs] of Object.entries(params.bootstrapCooldowns)) {
                if (durationMs > 0) {
                    this.cooldown.mark(profileId, durationMs);
                }
            }
        }
    }

    /** 获取所有 Profile（用于调试） */
    getProfiles(): ReadonlyArray<ModelProfile> {
        return this.profiles;
    }

    /**
     * 核心容灾请求方法。
     *
     * 依次尝试每个 Profile 发送请求，遇到可重试错误时自动切换到下一个。
     *
     * @param buildRequest  根据 Profile 构建 fetch 参数的函数
     * @param timeoutMs     单次请求超时（毫秒）
     * @returns             成功的 Response + 使用的 Profile + 尝试记录
     * @throws              如果所有 Profile 均失败
     */
    async fetchWithFailover(params: {
        /** 根据给定的 (baseUrl, apiKey, model) 构建 fetch 的 url 和 init */
        buildRequest: (profile: ModelProfile) => { url: string; init: RequestInit };
        /** 可选：调用方取消信号。若触发，应立即停止 failover / retry / backoff。 */
        signal?: AbortSignal;
        /** 单次请求超时（毫秒） */
        timeoutMs?: number;
        /** 请求超时下限（毫秒），会覆盖过小的 profile.requestTimeoutMs */
        minimumTimeoutMs?: number;
        /** 默认同 profile 最大重试次数（不含首次请求） */
        maxRetries?: number;
        /** 默认重试退避基线（毫秒） */
        retryBackoffMs?: number;
        /** 本次执行完成后的结构化摘要 */
        onSummary?: (summary: FailoverExecutionSummary) => void;
    }): Promise<FailoverResult> {
        const {
            buildRequest,
            signal,
            timeoutMs = 120_000,
            minimumTimeoutMs,
            maxRetries = 0,
            retryBackoffMs = 300,
            onSummary,
        } = params;
        const attempts: FailoverAttempt[] = [];
        const steps: FailoverExecutionStep[] = [];
        const reasonCounts: Partial<Record<FailoverReason, number>> = {};
        const startedAt = Date.now();
        const primaryProfileId = this.profiles[0]?.id ?? "primary";
        const configuredProfiles = this.profiles.map((profile) => ({
            profileId: profile.id ?? "unknown",
            provider: extractProvider(profile.baseUrl),
            model: profile.model,
            protocol: profile.protocol,
            wireApi: profile.wireApi,
        }));
        let lastError: Error | undefined;
        let requestCount = 0;

        const incrementReason = (reason: FailoverReason) => {
            reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
        };

        const buildSummary = (input: {
            finalStatus: FailoverExecutionStatus;
            profile?: ModelProfile;
            reason?: FailoverReason | "aborted";
            statusCode?: number;
        }): FailoverExecutionSummary => {
            const stepCounts = summarizeStepCounts(steps);
            const finalProfileId = input.profile?.id;
            const updatedAt = Date.now();
            return {
                configuredProfiles,
                finalStatus: input.finalStatus,
                finalProfileId,
                finalProvider: input.profile ? extractProvider(input.profile.baseUrl) : undefined,
                finalModel: input.profile?.model,
                finalReason: input.reason,
                finalStatusCode: input.statusCode,
                requestCount,
                failedStageCount: attempts.length,
                degraded: (
                    stepCounts.cooldownSkips
                    + stepCounts.sameProfileRetries
                    + stepCounts.crossProfileFallbacks
                    + stepCounts.terminalFailures
                ) > 0 || (finalProfileId !== undefined && finalProfileId !== primaryProfileId),
                stepCounts,
                reasonCounts: { ...reasonCounts },
                steps: steps.map((step) => ({ ...step })),
                startedAt,
                updatedAt,
                durationMs: Math.max(0, updatedAt - startedAt),
            };
        };

        const emitSummary = (summary: FailoverExecutionSummary): FailoverExecutionSummary => {
            try {
                onSummary?.(summary);
            } catch {
                // observer errors must not break the main failover path
            }
            return summary;
        };

        try {
            throwIfAborted(signal);

            for (let profileIndex = 0; profileIndex < this.profiles.length; profileIndex++) {
                throwIfAborted(signal);
                const profile = this.profiles[profileIndex];
                const profileId = profile.id ?? "unknown";
                const provider = extractProvider(profile.baseUrl);
                const baseTimeoutMs = normalizePositiveInt(profile.requestTimeoutMs) ?? timeoutMs;
                const timeoutFloorMs = normalizePositiveInt(minimumTimeoutMs) ?? 0;
                const resolvedTimeoutMs = Math.max(baseTimeoutMs, timeoutFloorMs);
                const resolvedMaxRetries = normalizeNonNegativeInt(profile.maxRetries) ?? maxRetries;
                const resolvedBackoffMs = normalizePositiveInt(profile.retryBackoffMs) ?? retryBackoffMs;
                const maxAttempts = resolvedMaxRetries + 1;
                const hasNextProfile = profileIndex < this.profiles.length - 1;

                const cooldownUntil = this.cooldown.peekUntil(profileId);
                if (cooldownUntil !== undefined) {
                    const lastLoggedUntil = this.cooldownSkipLogUntil.get(profileId);
                    if (lastLoggedUntil !== cooldownUntil) {
                        const remainingMs = Math.max(0, cooldownUntil - Date.now());
                        this.logger?.info("failover", `跳过冷却中的 Profile: ${profileId}（remaining=${remainingMs}ms）`);
                        this.cooldownSkipLogUntil.set(profileId, cooldownUntil);
                    }
                    const skippedAttempt: FailoverAttempt = {
                        profileId,
                        provider,
                        model: profile.model,
                        error: `Profile ${profileId} 处于冷却中，跳过`,
                        reason: "rate_limit",
                        maxAttempts,
                        timeoutMs: resolvedTimeoutMs,
                        wireApi: profile.wireApi,
                    };
                    attempts.push(skippedAttempt);
                    incrementReason("rate_limit");
                    steps.push({
                        kind: "cooldown_skip",
                        profileId,
                        provider,
                        model: profile.model,
                        reason: "rate_limit",
                        maxAttempts,
                        timeoutMs: resolvedTimeoutMs,
                        wireApi: profile.wireApi,
                        error: skippedAttempt.error,
                    });
                    continue;
                }

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    throwIfAborted(signal);
                    const { url, init } = buildRequest(profile);
                    const requestSignal = init.signal ?? undefined;
                    const externalSignal = signal ?? requestSignal;
                    throwIfAborted(externalSignal);
                    const attemptStartedAt = Date.now();

                    const controller = new AbortController();
                    let timedOut = false;
                    let removeAbortForwarder: (() => void) | undefined;
                    const timer = setTimeout(() => {
                        timedOut = true;
                        controller.abort();
                    }, resolvedTimeoutMs);

                    if (externalSignal) {
                        const onAbort = () => controller.abort();
                        externalSignal.addEventListener("abort", onAbort, { once: true });
                        removeAbortForwarder = () => externalSignal.removeEventListener("abort", onAbort);
                    }

                    try {
                        requestCount += 1;
                        const requestInit: RequestInit = {
                            ...init,
                            signal: controller.signal,
                        };

                        this.logger?.debug?.("failover", "Dispatching model request", {
                            profileId,
                            provider,
                            model: profile.model,
                            attempt,
                            maxAttempts,
                            timeoutMs: resolvedTimeoutMs,
                            wireApi: profile.wireApi,
                            url,
                        });

                        const response = await requestModelTransport({
                            url,
                            init: requestInit,
                            idleTimeoutMs: resolvedTimeoutMs,
                            proxyUrl: profile.proxyUrl,
                        });
                        const responseDurationMs = Date.now() - attemptStartedAt;
                        this.logger?.debug?.("failover", "Model request resolved", {
                            profileId,
                            provider,
                            model: profile.model,
                            attempt,
                            maxAttempts,
                            timeoutMs: resolvedTimeoutMs,
                            wireApi: profile.wireApi,
                            status: response.status,
                            ok: response.ok,
                            durationMs: responseDurationMs,
                        });

                        if (response.ok) {
                            this.cooldown.markSuccess(profileId);
                            this.cooldownSkipLogUntil.delete(profileId);
                            if (attempts.length > 0) {
                                this.logger?.info(
                                    "failover",
                                    `✅ Profile "${profileId}" (${profile.model}) 成功（经过 ${attempts.length} 次失败尝试）`,
                                );
                            }
                            const summary = emitSummary(buildSummary({
                                finalStatus: "success",
                                profile,
                            }));
                            return { response, profile, attempts, summary };
                        }

                        const errorText = await safeReadText(response);
                        const reason = classifyFailoverReason(response.status, errorText);
                        const errorMsg = `HTTP ${response.status}: ${errorText}`;
                        const canRetrySameProfile = attempt < maxAttempts && isSameProfileRetryable(reason);
                        incrementReason(reason);

                        const failedAttempt: FailoverAttempt = {
                            profileId,
                            provider,
                            model: profile.model,
                            error: errorMsg,
                            reason,
                            status: response.status,
                            attempt,
                            maxAttempts,
                            timeoutMs: resolvedTimeoutMs,
                            wireApi: profile.wireApi,
                        };
                        attempts.push(failedAttempt);
                        lastError = new Error(errorMsg);

                        if (!isRetryableReason(reason)) {
                            this.logger?.warn(
                                "failover",
                                `Profile "${profileId}" 返回 HTTP ${response.status}（${reason}），不可重试`,
                            );
                            steps.push({
                                kind: "terminal_fail",
                                profileId,
                                provider,
                                model: profile.model,
                                reason,
                                status: response.status,
                                attempt,
                                maxAttempts,
                                timeoutMs: resolvedTimeoutMs,
                                wireApi: profile.wireApi,
                                error: errorMsg,
                            });
                            const summary = emitSummary(buildSummary({
                                finalStatus: "non_retryable",
                                profile,
                                reason,
                                statusCode: response.status,
                            }));
                            return { response, profile, attempts, summary };
                        }

                        if (canRetrySameProfile) {
                            const retryAfterMs = reason === "rate_limit" ? parseRetryAfter(response) : undefined;
                            const waitMs = retryAfterMs ?? calcBackoffDelay(resolvedBackoffMs, attempt);
                            steps.push({
                                kind: "same_profile_retry",
                                profileId,
                                provider,
                                model: profile.model,
                                reason,
                                status: response.status,
                                attempt,
                                maxAttempts,
                                timeoutMs: resolvedTimeoutMs,
                                wireApi: profile.wireApi,
                                error: errorMsg,
                                waitMs,
                            });
                            this.logger?.warn(
                                "failover",
                                `⚠️ Profile "${profileId}" (${profile.model}) 失败: ${errorMsg}（attempt ${attempt}/${maxAttempts}, wire_api=${profile.wireApi ?? "-"}, timeout=${resolvedTimeoutMs}ms），${waitMs}ms 后重试同 profile...`,
                            );
                            await sleep(waitMs, externalSignal);
                            continue;
                        }

                        if (hasNextProfile) {
                            steps.push({
                                kind: "cross_profile_fallback",
                                profileId,
                                provider,
                                model: profile.model,
                                reason,
                                status: response.status,
                                attempt,
                                maxAttempts,
                                timeoutMs: resolvedTimeoutMs,
                                wireApi: profile.wireApi,
                                error: errorMsg,
                            });
                        }
                        this.logger?.warn(
                            "failover",
                            `⚠️ Profile "${profileId}" (${profile.model}) 失败: ${errorMsg}（attempt ${attempt}/${maxAttempts}, wire_api=${profile.wireApi ?? "-"}, timeout=${resolvedTimeoutMs}ms），尝试下一个...`,
                        );

                        const retryAfterMs = reason === "rate_limit" ? parseRetryAfter(response) : undefined;
                        this.cooldown.mark(profileId, resolveFailoverCooldownMs(reason, { retryAfterMs }));
                        break;
                    } catch (err) {
                        const responseDurationMs = Date.now() - attemptStartedAt;
                        const isAbort = err instanceof Error && err.name === "AbortError";
                        if (isAbort && externalSignal?.aborted && !timedOut) {
                            this.logger?.debug?.("failover", "Model request aborted by caller", {
                                profileId,
                                provider,
                                model: profile.model,
                                attempt,
                                maxAttempts,
                                timeoutMs: resolvedTimeoutMs,
                                wireApi: profile.wireApi,
                                durationMs: responseDurationMs,
                            });
                            throw toAbortError(externalSignal.reason);
                        }
                        const reason: FailoverReason = isAbort ? "timeout" : "unknown";
                        const errorMsg = isAbort
                            ? `请求超时（${resolvedTimeoutMs}ms）`
                            : err instanceof Error
                                ? err.message
                                : String(err);
                        this.logger?.debug?.("failover", "Model request failed before response", {
                            profileId,
                            provider,
                            model: profile.model,
                            attempt,
                            maxAttempts,
                            timeoutMs: resolvedTimeoutMs,
                            wireApi: profile.wireApi,
                            durationMs: responseDurationMs,
                            reason,
                            error: errorMsg,
                        });
                        const canRetrySameProfile = attempt < maxAttempts && isSameProfileRetryable(reason);
                        incrementReason(reason);

                        attempts.push({
                            profileId,
                            provider,
                            model: profile.model,
                            error: errorMsg,
                            reason,
                            attempt,
                            maxAttempts,
                            timeoutMs: resolvedTimeoutMs,
                            wireApi: profile.wireApi,
                        });
                        lastError = err instanceof Error ? err : new Error(String(err));

                        if (canRetrySameProfile) {
                            const waitMs = calcBackoffDelay(resolvedBackoffMs, attempt);
                            steps.push({
                                kind: "same_profile_retry",
                                profileId,
                                provider,
                                model: profile.model,
                                reason,
                                attempt,
                                maxAttempts,
                                timeoutMs: resolvedTimeoutMs,
                                wireApi: profile.wireApi,
                                error: errorMsg,
                                waitMs,
                            });
                            this.logger?.warn(
                                "failover",
                                `⚠️ Profile "${profileId}" (${profile.model}) 异常: ${errorMsg}（attempt ${attempt}/${maxAttempts}, wire_api=${profile.wireApi ?? "-"}, timeout=${resolvedTimeoutMs}ms），${waitMs}ms 后重试同 profile...`,
                            );
                            await sleep(waitMs, externalSignal);
                            continue;
                        }

                        if (hasNextProfile) {
                            steps.push({
                                kind: "cross_profile_fallback",
                                profileId,
                                provider,
                                model: profile.model,
                                reason,
                                attempt,
                                maxAttempts,
                                timeoutMs: resolvedTimeoutMs,
                                wireApi: profile.wireApi,
                                error: errorMsg,
                            });
                        }
                        this.logger?.warn(
                            "failover",
                            `⚠️ Profile "${profileId}" (${profile.model}) 异常: ${errorMsg}（attempt ${attempt}/${maxAttempts}, wire_api=${profile.wireApi ?? "-"}, timeout=${resolvedTimeoutMs}ms），尝试下一个...`,
                        );
                        this.cooldown.mark(profileId);
                        break;
                    } finally {
                        clearTimeout(timer);
                        removeAbortForwarder?.();
                    }
                }
            }

            const lastAttempt = attempts[attempts.length - 1];
            if (lastAttempt) {
                steps.push({
                    kind: "terminal_fail",
                    profileId: lastAttempt.profileId,
                    provider: lastAttempt.provider,
                    model: lastAttempt.model,
                    reason: lastAttempt.reason,
                    status: lastAttempt.status,
                    attempt: lastAttempt.attempt,
                    maxAttempts: lastAttempt.maxAttempts,
                    timeoutMs: lastAttempt.timeoutMs,
                    wireApi: lastAttempt.wireApi,
                    error: lastAttempt.error,
                });
            }

            const failureSummary = attempts
                .map((attempt) => `${attempt.profileId}/${attempt.model}: ${attempt.error} (${attempt.reason})`)
                .join(" | ");
            const summary = emitSummary(buildSummary({
                finalStatus: "exhausted",
                profile: lastAttempt
                    ? {
                        id: lastAttempt.profileId,
                        baseUrl: "",
                        apiKey: "",
                        model: lastAttempt.model,
                        wireApi: lastAttempt.wireApi,
                    }
                    : undefined,
                reason: lastAttempt?.reason,
                statusCode: lastAttempt?.status,
            }));

            const finalError = new FailoverExhaustedError(
                `所有模型均失败（共 ${attempts.length} 次尝试）: ${failureSummary}`,
                attempts,
                summary,
            );
            if (lastError) {
                finalError.cause = lastError;
            }
            throw finalError;
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                emitSummary(buildSummary({
                    finalStatus: "aborted",
                    reason: "aborted",
                }));
            }
            throw error;
        }
    }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

function normalizePositiveInt(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const rounded = Math.floor(value);
    return rounded > 0 ? rounded : undefined;
}

function normalizeNonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const rounded = Math.floor(value);
    return rounded >= 0 ? rounded : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized || undefined;
}

function isSameProfileRetryable(reason: FailoverReason): boolean {
    return reason === "timeout"
        || reason === "rate_limit"
        || reason === "server_error"
        || reason === "unknown";
}

function summarizeStepCounts(steps: FailoverExecutionStep[]): FailoverExecutionSummary["stepCounts"] {
    return {
        cooldownSkips: steps.filter((step) => step.kind === "cooldown_skip").length,
        sameProfileRetries: steps.filter((step) => step.kind === "same_profile_retry").length,
        crossProfileFallbacks: steps.filter((step) => step.kind === "cross_profile_fallback").length,
        terminalFailures: steps.filter((step) => step.kind === "terminal_fail").length,
    };
}

function calcBackoffDelay(baseMs: number, attempt: number): number {
    const safeBase = Math.max(100, baseMs);
    const exponent = Math.max(0, attempt - 1);
    return Math.min(safeBase * Math.pow(2, exponent), 5_000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            reject(toAbortError(signal.reason));
        };
        const cleanup = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw toAbortError(signal.reason);
}

function toAbortError(reason?: unknown): Error {
    if (reason instanceof Error) {
        reason.name = "AbortError";
        return reason;
    }
    const error = new Error(typeof reason === "string" && reason.trim() ? reason : "The operation was aborted.");
    error.name = "AbortError";
    return error;
}

/**
 * 解析 Retry-After 响应头。
 * 支持秒数（如 "30"）和 HTTP-date 格式。
 * 返回 undefined 表示无有效值（交给指数退避处理）。
 */
function parseRetryAfter(response: Response): number | undefined {
    const header = response.headers.get("retry-after");
    if (!header) return undefined;

    // 尝试解析为秒数
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000); // 转为毫秒
    }

    // 尝试解析为 HTTP-date
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
        const delayMs = date - Date.now();
        return delayMs > 0 ? delayMs : undefined;
    }

    return undefined;
}

/** 从 baseUrl 中提取 Provider 名称（用于日志） */
function extractProvider(baseUrl: string): string {
    try {
        const host = new URL(baseUrl).hostname;
        // api.openai.com → openai
        // api.moonshot.cn → moonshot
        const parts = host.split(".");
        if (parts.length >= 2) {
            return parts[parts.length - 2];
        }
        return host;
    } catch {
        return baseUrl;
    }
}

/** 错误正文按 UTF-8 字节流限界并清洗，避免 Provider 响应在截断前占满内存。 */
async function safeReadText(res: Response): Promise<string> {
    const result = await readResponseTextBounded(res, { maxBytes: 2048 });
    return result.truncated ? `${result.text}…` : result.text;
}

// ─── 配置加载 ─────────────────────────────────────────────────────────────

/** models.json 的格式 */
export type ModelConfigFile = {
    /** 备用 Profile 列表 */
    fallbacks: Array<{
        id?: string;
        displayName?: string;
        baseUrl: string;
        apiKey: string;
        model: string;
        protocol?: string;
        wireApi?: string;
        requestTimeoutMs?: number;
        maxRetries?: number;
        retryBackoffMs?: number;
        proxyUrl?: string;
        thinking?: Record<string, unknown>;
        reasoningEffort?: string;
        options?: Record<string, unknown>;
        requestBodyExtras?: Record<string, unknown>;
        messageLayout?: ModelMessageLayout;
    }>;
};

/**
 * 从 JSON 文件加载容灾配置。
 * 如果文件不存在或解析失败，返回空数组。
 */
export async function loadModelFallbacks(filePath: string): Promise<ModelProfile[]> {
    const { readFile } = await import("node:fs/promises");

    try {
        const raw = await readFile(filePath, "utf-8");
        const parsed = JSON.parse(stripUtf8Bom(raw)) as ModelConfigFile;

        if (!parsed.fallbacks || !Array.isArray(parsed.fallbacks)) {
            return [];
        }

        // 基本校验
        return parsed.fallbacks
            .filter((f) => f.baseUrl && f.apiKey && f.model)
            .map((f, i) => ({
                id: f.id ?? `fallback-${i}`,
                displayName: typeof f.displayName === "string" ? f.displayName : undefined,
                baseUrl: f.baseUrl,
                apiKey: f.apiKey,
                model: f.model,
                protocol: typeof f.protocol === "string" ? f.protocol : undefined,
                wireApi: typeof f.wireApi === "string" ? f.wireApi : undefined,
                requestTimeoutMs: normalizePositiveInt(f.requestTimeoutMs),
                maxRetries: normalizeNonNegativeInt(f.maxRetries),
                retryBackoffMs: normalizePositiveInt(f.retryBackoffMs),
                proxyUrl: typeof f.proxyUrl === "string" ? f.proxyUrl : undefined,
                thinking: isThinkingConfig(f.thinking) ? { ...f.thinking, type: normalizeThinkingType(f.thinking.type)! } : undefined,
                reasoningEffort: typeof f.reasoningEffort === "string" ? normalizeOptionalString(f.reasoningEffort) : undefined,
                options: isOptionsConfig(f.options) ? { ...f.options } : undefined,
                requestBodyExtras: isOptionsConfig(f.requestBodyExtras) ? { ...f.requestBodyExtras } : undefined,
                messageLayout: f.messageLayout === "single_system_only" ? "single_system_only" : undefined,
            }));
    } catch {
        // 文件不存在或解析失败，静默返回空
        return [];
    }
}

function normalizeThinkingType(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isThinkingConfig(value: unknown): value is Record<string, unknown> {
    return Boolean(value)
        && typeof value === "object"
        && !Array.isArray(value)
        && Boolean(normalizeThinkingType((value as Record<string, unknown>).type));
}

function isOptionsConfig(value: unknown): value is Record<string, unknown> {
    return Boolean(value)
        && typeof value === "object"
        && !Array.isArray(value);
}
