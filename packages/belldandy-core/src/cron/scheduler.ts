/**
 * Cron Scheduler - 定时任务调度引擎
 *
 * 每 TICK_INTERVAL_MS（30s）轮询检查所有 enabled 的 job，
 * 如果 nextRunAtMs ≤ now 则执行该任务。
 *
 * 支持：
 * - 活跃时段过滤（复用 Heartbeat 逻辑）
 * - 忙碌检测（防止插队）
 * - at 类型执行后自动 disable 或删除
 * - every 类型自动计算下次触发时间
 */

import type { CronGoalApprovalScanPayload, CronJob } from "./types.js";
import { CronStore, computeNextRunForJob } from "./store.js";
import type {
    BackgroundRunClaim,
    BackgroundRunClaimCoordinator,
} from "../background-run-coordinator.js";

/** 调度器轮询间隔：30 秒 */
const TICK_INTERVAL_MS = 30_000;

/** 最大并发执行数（防止 tick 堆积） */
const MAX_CONCURRENT_RUNS = 3;

export interface CronSchedulerOptions {
    /** CronStore 实例 */
    store: CronStore;
    /** 发送消息到 Agent 并获取回复 */
    sendMessage?: (
        job: CronJob,
        prompt: string,
        context: CronRunExecutionContext,
    ) => Promise<string | { text: string; conversationId?: string }>;
    /** 直接执行 goal approval scan */
    runGoalApprovalScan?: (payload: CronGoalApprovalScanPayload) => Promise<CronGoalApprovalScanResult>;
    /** 推送消息到用户渠道 */
    deliverToUser?: (message: string) => Promise<void>;
    /** 系统是否忙碌 */
    isBusy?: () => boolean;
    /** 跨 Cron / Heartbeat 的进程内背景运行预算 */
    runCoordinator?: BackgroundRunClaimCoordinator;
    /** 活跃时段（如 { start: "08:00", end: "23:00" }） */
    activeHours?: { start: string; end: string };
    /** 用户时区 */
    timezone?: string;
    /** 日志函数 */
    log?: (message: string) => void;
    /** 运行态事件（用于统一 background continuation ledger） */
    onExecutionEvent?: (event: CronExecutionEvent) => void | Promise<void>;
}

export interface CronRunExecutionContext {
    signal: AbortSignal;
    generation: number;
}

export interface CronSchedulerHandle {
    /** 停止调度器 */
    stop: () => void;
    /** 停止接收新运行，并等待已接受的 Cron 运行结束 */
    stopAndDrain: () => Promise<void>;
    /** 获取当前状态 */
    status: () => CronSchedulerStatus;
    /** 立即执行指定 job（用于最小恢复链路） */
    runJobNow: (jobId: string) => Promise<{
        runId?: string;
        status: "ok" | "error" | "skipped";
        summary?: string;
        reason?: string;
      }>;
}

export interface CronSchedulerStatus {
    running: boolean;
    totalJobs: number;
    enabledJobs: number;
    activeRuns: number;
    lastTickAtMs?: number;
}

export interface CronGoalApprovalScanResult {
    /** 执行摘要，用于日志与状态观测 */
    summary: string;
    /** 可选用户通知文案；为空时仅记录运行态，不主动通知 */
    notifyMessage?: string;
}

export type CronExecutionEvent =
    | {
        phase: "started";
        runId: string;
        jobId: string;
        jobName: string;
        payloadKind: CronJob["payload"]["kind"];
        sessionTarget: CronJob["sessionTarget"];
        conversationId?: string;
        startedAt: number;
      }
    | {
        phase: "finished";
        runId: string;
        jobId: string;
        jobName: string;
        payloadKind: CronJob["payload"]["kind"];
        sessionTarget: CronJob["sessionTarget"];
        conversationId?: string;
        startedAt: number;
        finishedAt: number;
        status: "ok" | "error" | "skipped";
        summary?: string;
        reason?: string;
        nextRunAtMs?: number;
      };

function normalizeSendMessageResult(
    result: string | { text: string; conversationId?: string },
): { text: string; conversationId?: string } {
    if (typeof result === "string") {
        return { text: result };
    }
    return {
        text: typeof result?.text === "string" ? result.text : "",
        conversationId: typeof result?.conversationId === "string" ? result.conversationId.trim() || undefined : undefined,
    };
}

export function startCronScheduler(options: CronSchedulerOptions): CronSchedulerHandle {
    const {
        store,
        sendMessage,
        runGoalApprovalScan,
        deliverToUser,
        isBusy,
        runCoordinator,
        activeHours,
        timezone,
        log = console.log,
        onExecutionEvent,
    } = options;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let activeRuns = 0;
    let lastTickAtMs: number | undefined;
    let tickInFlight = false;
    let drainPromise: Promise<void> | undefined;
    let nextLocalGeneration = 0;
    const intakeController = new AbortController();
    const activeJobIds = new Set<string>();
    const activeOperations = new Set<Promise<unknown>>();

    // 仅记录已经进入 scheduler 的运行；stop 后不会再有新 operation 加入，便于上层等待局部 drain。
    const trackActiveOperation = <T>(operation: Promise<T>): Promise<T> => {
        activeOperations.add(operation);
        void operation.then(
            () => {
                activeOperations.delete(operation);
            },
            () => {
                activeOperations.delete(operation);
            },
        );
        return operation;
    };

    const getLocalClaimRejection = (jobId: string): { reason: string } | undefined => {
        if (stopped) {
            return { reason: "Cron scheduler is stopped." };
        }
        if (activeJobIds.has(jobId)) {
            return { reason: `Cron job ${jobId} is already running.` };
        }
        if (activeRuns >= MAX_CONCURRENT_RUNS) {
            return { reason: "Cron scheduler has reached its concurrent run limit." };
        }
        return undefined;
    };

    const reserveLocalRun = (
        jobId: string,
        coordinatorClaim?: BackgroundRunClaim,
    ): BackgroundRunClaim => {
        activeJobIds.add(jobId);
        activeRuns++;
        let released = false;
        let completing = false;
        const signal = coordinatorClaim?.signal ?? new AbortController().signal;
        const finalizeRelease = () => {
            if (released) return;
            released = true;
            activeJobIds.delete(jobId);
            activeRuns = Math.max(0, activeRuns - 1);
            coordinatorClaim?.release();
        };
        return {
            generation: coordinatorClaim?.generation ?? ++nextLocalGeneration,
            signal,
            complete: async <T>(commit: () => T | Promise<T>) => {
                if (released || completing) {
                    return { applied: false };
                }
                completing = true;
                try {
                    if (coordinatorClaim) {
                        return await coordinatorClaim.complete(commit);
                    }
                    if (signal.aborted) {
                        return { applied: false };
                    }
                    return { applied: true, value: await commit() };
                } finally {
                    finalizeRelease();
                }
            },
            release: () => {
                if (completing) return;
                finalizeRelease();
            },
        };
    };

    // tick 保留同步兼容入口；手动运行可通过 acquire 等待共享预算。
    const tryClaimRun = (
        jobId: string,
    ): BackgroundRunClaim | { reason: string } => {
        const localRejection = getLocalClaimRejection(jobId);
        if (localRejection) return localRejection;

        let coordinatorClaim: BackgroundRunClaim | undefined;
        if (runCoordinator) {
            const claim = runCoordinator.tryClaim({
                kind: "cron",
                key: jobId,
                signal: intakeController.signal,
            });
            if ("reason" in claim) {
                return { reason: claim.reason };
            }
            coordinatorClaim = claim;
        }

        return reserveLocalRun(jobId, coordinatorClaim);
    };

    const acquireRun = async (
        jobId: string,
        priority: "high" | "normal" = "high",
    ): Promise<BackgroundRunClaim | { reason: string }> => {
        if (!runCoordinator?.acquire) {
            return tryClaimRun(jobId);
        }
        const localRejection = getLocalClaimRejection(jobId);
        if (localRejection) return localRejection;
        const coordinatorClaim = await runCoordinator.acquire({
            kind: "cron",
            key: jobId,
            priority,
            signal: intakeController.signal,
        });
        if ("reason" in coordinatorClaim) {
            return stopped
                ? { reason: "Cron scheduler is stopped." }
                : coordinatorClaim;
        }
        const rejectionAfterWait = getLocalClaimRejection(jobId);
        if (rejectionAfterWait) {
            coordinatorClaim.release();
            return rejectionAfterWait;
        }
        return reserveLocalRun(jobId, coordinatorClaim);
    };

    const markJobsSkipped = async (jobs: CronJob[], now: number, reason: string): Promise<boolean> => {
        let changed = false;
        for (const job of jobs) {
            if (job.state.lastStatus === "skipped" && job.state.lastError === reason) {
                continue;
            }
            job.state.lastRunAtMs = now;
            job.state.lastDurationMs = 0;
            job.state.lastStatus = "skipped";
            job.state.lastError = reason;
            await onExecutionEvent?.({
                phase: "finished",
                runId: `cron-skip-${job.id}-${now}`,
                jobId: job.id,
                jobName: job.name,
                payloadKind: job.payload.kind,
                sessionTarget: job.sessionTarget,
                startedAt: now,
                finishedAt: now,
                status: "skipped",
                reason,
                nextRunAtMs: job.state.nextRunAtMs,
            });
            changed = true;
        }
        return changed;
    };

    // 活跃时段检查（复用 Heartbeat 的逻辑）
    const isWithinActiveHours = (now: number): boolean => {
        if (!activeHours) return true;

        const parseTime = (time: string): number | null => {
            const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
            if (!match) return null;
            const h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            if (h < 0 || h > 24 || m < 0 || m > 59) return null;
            if (h === 24 && m === 0) return 24 * 60;
            if (h === 24) return null;
            return h * 60 + m;
        };

        const startMin = parseTime(activeHours.start);
        const endMin = parseTime(activeHours.end);
        if (startMin === null || endMin === null) return true;

        let currentMin: number;
        try {
            const tz = timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: tz,
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            }).formatToParts(new Date(now));
            const map: Record<string, string> = {};
            for (const part of parts) {
                if (part.type !== "literal") map[part.type] = part.value;
            }
            currentMin = Number(map.hour) * 60 + Number(map.minute);
        } catch {
            const d = new Date(now);
            currentMin = d.getHours() * 60 + d.getMinutes();
        }

        if (endMin > startMin) {
            return currentMin >= startMin && currentMin < endMin;
        }
        // 跨午夜
        return currentMin >= startMin || currentMin < endMin;
    };

    // Agent/扫描可以在取消后迟到返回；所有终态副作用统一由 claim completion fence 提交。
    const executeJob = async (
        job: CronJob,
        jobs: CronJob[],
        claim: BackgroundRunClaim,
        persistJobs: () => Promise<void>,
    ): Promise<{
        runId?: string;
        status: "ok" | "error" | "skipped";
        summary?: string;
        reason?: string;
      }> => {
        const startedAt = Date.now();
        const runId = `cron-run-${job.id}-${startedAt}`;
        const context: CronRunExecutionContext = {
            signal: claim.signal,
            generation: claim.generation,
        };
        let status: "ok" | "error" = "ok";
        let summary: string | undefined;
        let reason: string | undefined;
        let notifyMessage: string | undefined;
        let conversationId: string | undefined;

        log(`[cron] 执行任务 "${job.name}" (${job.id})`);
        await onExecutionEvent?.({
            phase: "started",
            runId,
            jobId: job.id,
            jobName: job.name,
            payloadKind: job.payload.kind,
            sessionTarget: job.sessionTarget,
            startedAt,
        });

        try {
            if (job.payload.kind === "systemEvent") {
                if (!sendMessage) {
                    throw new Error("Cron systemEvent executor is not available.");
                }
                const response = normalizeSendMessageResult(await sendMessage(job, job.payload.text, context));
                summary = response.text?.trim() || "systemEvent completed";
                notifyMessage = response.text?.trim() || undefined;
                conversationId = response.conversationId;
            } else if (job.payload.kind === "goalApprovalScan") {
                if (!runGoalApprovalScan) {
                    throw new Error("Cron goalApprovalScan executor is not available.");
                }
                const result = await runGoalApprovalScan(job.payload);
                summary = result.summary.trim();
                notifyMessage = result.notifyMessage?.trim() || undefined;
            }
        } catch (err) {
            status = "error";
            reason = err instanceof Error ? err.message : String(err);
        }

        const completion = await claim.complete(async () => {
            const finishedAt = Date.now();
            job.state.lastRunAtMs = finishedAt;
            job.state.lastDurationMs = finishedAt - startedAt;
            job.state.lastStatus = status;
            job.state.lastError = reason;

            if (status === "ok") {
                if (notifyMessage && deliverToUser && job.delivery.mode !== "none") {
                    try {
                        await deliverToUser(`🕐 [Cron: ${job.name}] ${notifyMessage}`);
                        log(`[cron] 任务 "${job.name}" 完成并已投递 (${job.state.lastDurationMs}ms) | ${summary ?? ""}`);
                    } catch (deliverErr) {
                        const message = deliverErr instanceof Error ? deliverErr.message : String(deliverErr);
                        log(`[cron] 任务 "${job.name}" 投递失败: ${message}`);
                    }
                } else {
                    log(`[cron] 任务 "${job.name}" 完成 (${job.state.lastDurationMs}ms) | ${summary ?? ""}`);
                }
            } else {
                log(`[cron] 任务 "${job.name}" 执行失败: ${reason}`);
                if (deliverToUser && job.failureDestination?.mode === "user") {
                    try {
                        await deliverToUser(`⚠️ [Cron: ${job.name}] 执行失败：${reason}`);
                    } catch (deliverErr) {
                        const message = deliverErr instanceof Error ? deliverErr.message : String(deliverErr);
                        log(`[cron] 任务 "${job.name}" 失败通知投递失败: ${message}`);
                    }
                }
            }

            if (job.schedule.kind === "at") {
                if (job.deleteAfterRun) {
                    const index = jobs.indexOf(job);
                    if (index !== -1) jobs.splice(index, 1);
                    log(`[cron] 一次性任务 "${job.name}" 已删除`);
                } else {
                    job.enabled = false;
                    job.state.nextRunAtMs = undefined;
                    log(`[cron] 一次性任务 "${job.name}" 已禁用`);
                }
            } else {
                job.state.nextRunAtMs = computeNextRunForJob(job, Date.now());
            }

            await onExecutionEvent?.({
                phase: "finished",
                runId,
                jobId: job.id,
                jobName: job.name,
                payloadKind: job.payload.kind,
                sessionTarget: job.sessionTarget,
                conversationId,
                startedAt,
                finishedAt,
                status,
                summary,
                reason,
                nextRunAtMs: job.state.nextRunAtMs,
            });
            await persistJobs();
            return { runId, status, summary, reason };
        });

        if (!completion.applied) {
            return {
                status: "skipped",
                reason: "Cron run completion was discarded because its claim is no longer active.",
            };
        }
        return completion.value;
    };

    // 调度 tick
    const tick = async (): Promise<void> => {
        if (stopped) return;
        if (tickInFlight) return;
        tickInFlight = true;

        try {
            const now = Date.now();
            lastTickAtMs = now;

            // 加载任务列表
            let jobs: CronJob[];
            let baseJobs: CronJob[];
            try {
                jobs = await store.list();
                baseJobs = cloneCronJobSnapshot(jobs);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                log(`[cron] 加载任务失败: ${msg}`);
                return;
            }
            // stop 可能发生在 Store 读取期间；此时不再接纳或写入新的 tick 工作。
            if (stopped) return;

            if (jobs.length === 0) return;

            // 筛选需要执行的任务
            const dueJobs = jobs.filter(
                (j) => j.enabled && j.state.nextRunAtMs !== undefined && j.state.nextRunAtMs <= now
            );

            if (dueJobs.length === 0) return;

            // 活跃时段检查
            if (!isWithinActiveHours(now)) {
                const changed = await markJobsSkipped(dueJobs, now, "Skipped: outside active hours.");
                if (changed) {
                    await store.saveJobs(jobs, baseJobs);
                }
                return;
            }

            // 忙碌检查
            if (isBusy?.()) {
                const changed = await markJobsSkipped(dueJobs, now, "Skipped: scheduler is busy.");
                if (changed) {
                    await store.saveJobs(jobs, baseJobs);
                }
                return;
            }

            // 维持每 tick 的既有执行上限，同时跳过已被手动路径持有的 job claim。
            const availableRunSlots = Math.max(0, MAX_CONCURRENT_RUNS - activeRuns);
            if (availableRunSlots === 0) return;
            let claimedRunCount = 0;

            // 顺序执行（避免 Agent 并发问题）
            for (const job of dueJobs) {
                if (stopped) break;
                if (claimedRunCount >= availableRunSlots) break;
                const claim = await acquireRun(job.id, "normal");
                if ("reason" in claim) {
                    continue;
                }
                claimedRunCount++;
                try {
                    await executeJob(job, jobs, claim, async () => {
                        try {
                            await store.saveJobs(jobs, baseJobs);
                        } catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            log(`[cron] 保存状态失败: ${message}`);
                        }
                    });
                } finally {
                    claim.release();
                }
            }
        } finally {
            tickInFlight = false;
        }
    };

    // 启动调度
    log(`[cron] scheduler started, tick interval: ${TICK_INTERVAL_MS / 1000}s`);
    timer = setInterval(() => {
        if (!stopped) {
            const tickOperation = trackActiveOperation(tick());
            void tickOperation.catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                log(`[cron] tick error: ${msg}`);
            });
        }
    }, TICK_INTERVAL_MS);

    const stop = () => {
        if (stopped) return;
        stopped = true;
        intakeController.abort(new Error("Cron scheduler is stopping."));
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        log("[cron] scheduler stopped");
    };

    const stopAndDrain = (): Promise<void> => {
        stop();
        if (!drainPromise) {
            // stop 先关闭 intake；随后快照的 operation 即为本地已接受、仍需结算的运行。
            drainPromise = Promise.allSettled([...activeOperations]).then(() => undefined);
        }
        return drainPromise;
    };

    return {
        stop,
        stopAndDrain,
        status: () => {
            // 同步获取状态（异步读 store 会阻塞，这里返回缓存值）
            return {
                running: !stopped,
                totalJobs: -1, // 需要异步读取，这里用 -1 表示未知
                enabledJobs: -1,
                activeRuns,
                lastTickAtMs,
            };
        },
        runJobNow: (jobId: string) => {
            // 整个公开调用都属于已接受 operation，包含 Store read 与 coordinator queue wait。
            const operation = (async () => {
                if (stopped) {
                    return { status: "skipped" as const, reason: "Cron scheduler is stopped." };
                }
                const normalizedJobId = String(jobId || "").trim();
                if (!normalizedJobId) {
                    return { status: "skipped" as const, reason: "Cron job id is required." };
                }
                const jobs = await store.list();
                if (stopped) {
                    return { status: "skipped" as const, reason: "Cron scheduler is stopped." };
                }
                const baseJobs = cloneCronJobSnapshot(jobs);
                const job = jobs.find((item) => item.id === normalizedJobId);
                if (!job || !job.enabled) {
                    return { status: "skipped" as const, reason: `Cron job ${normalizedJobId} is not available.` };
                }
                const claim = await acquireRun(job.id);
                if ("reason" in claim) {
                    return { status: "skipped" as const, reason: claim.reason };
                }
                try {
                    return await executeJob(
                        job,
                        jobs,
                        claim,
                        () => store.saveJobs(jobs, baseJobs),
                    );
                } finally {
                    claim.release();
                }
            })();
            return trackActiveOperation(operation);
        },
    };
}

function cloneCronJobSnapshot(jobs: CronJob[]): CronJob[] {
    // CronJob 是 JSON 持久化数据；执行外部调用前保留独立 base，供短锁内 rebase 使用。
    return JSON.parse(JSON.stringify(jobs)) as CronJob[];
}
