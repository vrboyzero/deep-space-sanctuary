/**
 * Heartbeat Runner - 心跳定时任务系统
 *
 * 定期读取 HEARTBEAT.md 并触发 Agent 检查任务
 * 对标 Moltbot 实现：支持时区感知、状态持久化、消息去重、忙碌检测
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { BackgroundRunClaimCoordinator } from "../background-run-coordinator.js";
import {
    isHeartbeatContentEffectivelyEmpty,
    isHeartbeatOkResponse,
    stripHeartbeatToken,
    DEFAULT_HEARTBEAT_PROMPT,
    HEARTBEAT_OK_TOKEN,
} from "./content.js";

export interface HeartbeatRunnerOptions {
    /** 心跳间隔毫秒（默认 30 分钟） */
    intervalMs?: number;
    /** Workspace 目录（如 ~/.star_sanctuary） */
    workspaceDir: string;
    /** 发送消息到 Agent 并获取回复 */
    sendMessage: (input: { prompt: string; conversationId: string; runId: string }) => Promise<string>;
    /** 推送消息到用户渠道（如飞书） */
    deliverToUser?: (message: string) => Promise<void>;
    /** 自定义心跳 prompt */
    prompt?: string;
    /** 活跃时段（如 "08:00-23:00"） */
    activeHours?: { start: string; end: string };
    /** 用户时区（如 "Asia/Shanghai", "local", "user"） */
    timezone?: string;
    /** 系统是否忙碌（防止插队） */
    isBusy?: () => boolean;
    /** 跨 Cron / Heartbeat 的进程内背景运行预算 */
    runCoordinator?: BackgroundRunClaimCoordinator;
    /** 日志函数 */
    log?: (message: string) => void;
    /** 运行态事件（用于统一 background continuation ledger） */
    onRunEvent?: (event: HeartbeatRunEvent) => void | Promise<void>;
}

export interface HeartbeatRunnerHandle {
    /** 停止心跳 */
    stop: () => void;
    /** 停止接收新运行，并等待已接受的心跳结束 */
    stopAndDrain: () => Promise<void>;
    /** 立即触发一次心跳（用于测试） */
    runOnce: () => Promise<HeartbeatResult>;
}

export interface HeartbeatResult {
    status: "ran" | "skipped" | "failed";
    reason?: string;
    durationMs?: number;
    message?: string;
    runId?: string;
    conversationId?: string;
}

export type HeartbeatRunEvent =
    | {
        phase: "started";
        runId: string;
        conversationId: string;
        startedAt: number;
      }
    | {
        phase: "finished";
        runId: string;
        conversationId: string;
        startedAt: number;
        finishedAt: number;
        result: HeartbeatResult;
      };

interface HeartbeatState {
    lastRunAt: number;
    lastHeartbeatText?: string;
    lastHeartbeatSentAt?: number;
}

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
const HEARTBEAT_FILENAME = "HEARTBEAT.md";
const STATE_FILENAME = "heartbeat-state.json";

/**
 * 解析 HH:MM 时间
 */
function parseTime(time: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
    // Handle 24:00
    if (hours === 24 && minutes === 0) return 24 * 60;
    if (hours === 24) return null;
    return hours * 60 + minutes;
}

/**
 * 以指定时区获取当前时间的分钟数 (0-1440)
 */
function resolveMinutesInTimeZone(now: number, timeZone: string): number | null {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(now));
        const map: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== "literal") map[part.type] = part.value;
        }
        const hour = Number(map.hour);
        const minute = Number(map.minute);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
        return hour * 60 + minute;
    } catch {
        return null; // Invalid timezone
    }
}

/**
 * 检查活跃时段 (Moltbot compatible)
 */
function isWithinActiveHours(
    now: number,
    activeHours?: { start: string; end: string },
    timezone?: string
): boolean {
    if (!activeHours) return true;

    const startMin = parseTime(activeHours.start);
    const endMin = parseTime(activeHours.end);
    if (startMin === null || endMin === null) return true;

    // Resolve timezone
    let tz = timezone?.trim() || "local";
    if (tz === "local") {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }
    // "user" usually handled by caller passing user timezone, treating unknown as local fallback check below

    let currentMin = resolveMinutesInTimeZone(now, tz);
    if (currentMin === null) {
        // Fallback to simple local date if timezone invalid
        const d = new Date(now);
        currentMin = d.getHours() * 60 + d.getMinutes();
    }

    if (endMin > startMin) {
        return currentMin >= startMin && currentMin < endMin;
    } else {
        // Cross midnight (e.g. 22:00 - 06:00)
        return currentMin >= startMin || currentMin < endMin;
    }
}

/**
 * 持久化状态管理
 */
async function loadState(dir: string): Promise<HeartbeatState> {
    try {
        const content = await fs.readFile(path.join(dir, STATE_FILENAME), "utf-8");
        return JSON.parse(content);
    } catch {
        return { lastRunAt: 0 };
    }
}

async function saveState(dir: string, state: HeartbeatState) {
    try {
        await fs.writeFile(path.join(dir, STATE_FILENAME), JSON.stringify(state, null, 2), "utf-8");
    } catch {
        // ignore write error
    }
}

export function startHeartbeatRunner(
    options: HeartbeatRunnerOptions
): HeartbeatRunnerHandle {
    const {
        intervalMs = DEFAULT_INTERVAL_MS,
        workspaceDir,
        sendMessage,
        deliverToUser,
        prompt = DEFAULT_HEARTBEAT_PROMPT,
        activeHours,
        timezone,
        isBusy,
        runCoordinator,
        log = console.log,
        onRunEvent,
    } = options;

    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let activeRun: Promise<HeartbeatResult> | undefined;
    let drainPromise: Promise<void> | undefined;

    const executeHeartbeat = async (): Promise<HeartbeatResult> => {
        const startedAt = Date.now();
        const runId = `heartbeat-run-${startedAt}`;
        const conversationId = `heartbeat-${startedAt}`;

        // 0. Queue Awareness: Check busy
        if (isBusy && isBusy()) {
            log(`[heartbeat] skipped: system is busy`);
            const result = { status: "skipped", reason: "requests-in-flight", runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: startedAt,
                result,
            });
            return result;
        }

        // 1. Timezone & Active Hours
        if (!isWithinActiveHours(startedAt, activeHours, timezone)) {
            // Log less frequently? No, logging skipped is fine for debugging.
            // But to avoid log spam, maybe only debug log. Using provided log function.
            log(`[heartbeat] skipped: outside active hours`);
            const result = { status: "skipped", reason: "quiet-hours", runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: startedAt,
                result,
            });
            return result;
        }

        // 2. Read HEARTBEAT.md
        const heartbeatPath = path.join(workspaceDir, HEARTBEAT_FILENAME);
        let content: string;
        try {
            content = await fs.readFile(heartbeatPath, "utf-8");
        } catch (err) {
            log(`[heartbeat] skipped: HEARTBEAT.md not found`);
            const result = { status: "skipped", reason: "file-not-found", runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: Date.now(),
                result,
            });
            return result;
        }

        if (isHeartbeatContentEffectivelyEmpty(content)) {
            log(`[heartbeat] skipped: HEARTBEAT.md is empty`);
            const result = { status: "skipped", reason: "empty-heartbeat-file", runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: Date.now(),
                result,
            });
            return result;
        }

        // 3. Execute
        log(`[heartbeat] running...`);
        await onRunEvent?.({
            phase: "started",
            runId,
            conversationId,
            startedAt,
        });
        let response: string;
        try {
            response = await sendMessage({ prompt, conversationId, runId });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`[heartbeat] failed: ${message}`);
            const result = { status: "failed", reason: message, runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: Date.now(),
                result,
            });
            return result;
        }

        const durationMs = Date.now() - startedAt;

        // 4. Handle Response
        if (isHeartbeatOkResponse(response)) {
            log(`[heartbeat] ok (${durationMs}ms)`);
            const result = { status: "ran", reason: "ok", durationMs, runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: Date.now(),
                result,
            });
            return result;
        }

        const cleanedResponse = stripHeartbeatToken(response);
        if (!cleanedResponse) {
            const result = { status: "ran", reason: "ok-empty", durationMs, runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: Date.now(),
                result,
            });
            return result;
        }

        // 5. Deduplication (Anti-Nagging)
        const state = await loadState(workspaceDir);
        const prevText = state.lastHeartbeatText || "";
        const prevTime = state.lastHeartbeatSentAt || 0;
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        // 如果内容完全对等，且距离上次发送不足 24 小时 -> 跳过
        if (
            prevText.trim() === cleanedResponse.trim() &&
            (Date.now() - prevTime) < ONE_DAY_MS
        ) {
            log(`[heartbeat] skipped: duplicate content (deduplication active)`);
            const result = { status: "skipped", reason: "duplicate", message: cleanedResponse, runId, conversationId } satisfies HeartbeatResult;
            await onRunEvent?.({
                phase: "finished",
                runId,
                conversationId,
                startedAt,
                finishedAt: Date.now(),
                result,
            });
            return result;
        }

        // 6. Deliver
        if (deliverToUser) {
            try {
                await deliverToUser(cleanedResponse);
                log(`[heartbeat] delivered to user (${durationMs}ms)`);

                // Update State
                state.lastHeartbeatText = cleanedResponse;
                state.lastHeartbeatSentAt = Date.now();
                await saveState(workspaceDir, state);

            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log(`[heartbeat] delivery failed: ${message}`);
            }
        }

        // Update run time
        state.lastRunAt = Date.now();
        await saveState(workspaceDir, state);

        const result = {
            status: "ran",
            durationMs,
            message: cleanedResponse,
            runId,
            conversationId,
        } satisfies HeartbeatResult;
        await onRunEvent?.({
            phase: "finished",
            runId,
            conversationId,
            startedAt,
            finishedAt: Date.now(),
            result,
        });

        return result;
    };

    // interval 与公开 runOnce 共用单一 claim，避免手动恢复与自动心跳重复调用 Agent/投递。
    const runOnce = (): Promise<HeartbeatResult> => {
        if (stopped) {
            return Promise.resolve({ status: "skipped", reason: "runner-stopped" });
        }
        if (activeRun) {
            log(`[heartbeat] skipped: previous run still in flight`);
            return Promise.resolve({ status: "skipped", reason: "already-running" });
        }

        let releaseCoordinator: (() => void) | undefined;
        if (runCoordinator) {
            const coordinatorClaim = runCoordinator.tryClaim({ kind: "heartbeat", key: "heartbeat" });
            if ("reason" in coordinatorClaim) {
                log(`[heartbeat] skipped: ${coordinatorClaim.reason}`);
                return Promise.resolve({ status: "skipped", reason: coordinatorClaim.reason });
            }
            releaseCoordinator = coordinatorClaim.release;
        }

        const run = executeHeartbeat();
        activeRun = run;
        void run.then(
            () => {
                releaseCoordinator?.();
                if (activeRun === run) {
                    activeRun = undefined;
                }
            },
            () => {
                releaseCoordinator?.();
                if (activeRun === run) {
                    activeRun = undefined;
                }
            },
        );
        return run;
    };

    const scheduleNext = () => {
        if (stopped) return;
        timer = setInterval(() => {
            if (stopped) return;
            void runOnce().catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                log(`[heartbeat] error: ${message}`);
            });
        }, intervalMs);
    };

    log(`[heartbeat] started, interval: ${Math.round(intervalMs / 1000 / 60)}m`);
    scheduleNext();

    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        log(`[heartbeat] stopped`);
    };

    const stopAndDrain = (): Promise<void> => {
        stop();
        if (!drainPromise) {
            const acceptedRun = activeRun;
            drainPromise = acceptedRun
                ? acceptedRun.then(() => undefined, () => undefined)
                : Promise.resolve();
        }
        return drainPromise;
    };

    return {
        stop,
        stopAndDrain,
        runOnce,
    };
}

export { HEARTBEAT_OK_TOKEN, DEFAULT_HEARTBEAT_PROMPT };
