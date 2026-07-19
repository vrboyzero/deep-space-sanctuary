/**
 * Cron Store - JSON 文件持久化
 *
 * 将定时任务列表存储在 ~/.star_sanctuary/cron-jobs.json 中
 * 支持 CRUD 操作，写入时使用临时文件 + rename 保证原子性
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { CronJob, CronJobCreate, CronJobPatch, CronStoreFile } from "./types.js";
import { applyCronJobRuntimeDefaults, normalizeCronJobCreateInput, normalizeCronJobPatchInput, normalizeCronStaggerMs } from "./validation.js";
import { withCronStoreMutationLock } from "./store-mutation-queue.js";

const STORE_FILENAME = "cron-jobs.json";
const MINUTE_MS = 60_000;
const WEEKDAY_MAP: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
};

type LocalDateParts = {
    year: number;
    month: number;
    day: number;
};

type LocalDateTimeParts = LocalDateParts & {
    hour: number;
    minute: number;
};

type ZonedDateTimeParts = LocalDateTimeParts & {
    weekday: number;
};

export class CronStore {
    private readonly filePath: string;

    constructor(stateDir: string) {
        this.filePath = path.join(stateDir, STORE_FILENAME);
    }

    // ── 读取 ──

    /** 加载所有任务 */
    async list(): Promise<CronJob[]> {
        const data = await this.load();
        return data.jobs;
    }

    /** 获取单个任务 */
    async get(id: string): Promise<CronJob | undefined> {
        const jobs = await this.list();
        return jobs.find((j) => j.id === id);
    }

    // ── 写入 ──

    /** 创建新任务，返回完整 Job 对象 */
    async add(input: CronJobCreate): Promise<CronJob> {
        return this.mutate(async () => {
            const data = await this.load();
            const now = Date.now();

            const normalized = normalizeCronJobCreateInput(input);
            const jobId = crypto.randomUUID();
            const job: CronJob = {
                id: jobId,
                name: normalized.name,
                description: normalized.description,
                enabled: normalized.enabled ?? true,
                deleteAfterRun: normalized.deleteAfterRun,
                createdAtMs: now,
                updatedAtMs: now,
                schedule: normalized.schedule,
                payload: normalized.payload,
                sessionTarget: normalized.sessionTarget ?? "isolated",
                delivery: normalized.delivery ?? { mode: "user" },
                failureDestination: normalized.failureDestination,
                state: {
                    nextRunAtMs: computeNextRunForJob({
                        id: jobId,
                        schedule: normalized.schedule,
                    }, now),
                },
            };

            data.jobs.push(applyCronJobRuntimeDefaults(job));
            await this.save(data);
            return applyCronJobRuntimeDefaults(job);
        });
    }

    /** 更新任务，返回更新后的 Job 或 undefined（未找到） */
    async update(id: string, patch: CronJobPatch): Promise<CronJob | undefined> {
        return this.mutate(async () => {
            const data = await this.load();
            const index = data.jobs.findIndex((j) => j.id === id);
            if (index === -1) return undefined;

            const job = data.jobs[index];
            const now = Date.now();
            const normalizedPatch = normalizeCronJobPatchInput(patch, job);

            // 应用 patch（只覆盖非 undefined 字段）
            if (normalizedPatch.name !== undefined) job.name = normalizedPatch.name;
            if ("description" in normalizedPatch) job.description = normalizedPatch.description;
            if (normalizedPatch.enabled !== undefined) job.enabled = normalizedPatch.enabled;
            if (normalizedPatch.deleteAfterRun !== undefined) job.deleteAfterRun = normalizedPatch.deleteAfterRun;
            if (normalizedPatch.schedule !== undefined) {
                job.schedule = normalizedPatch.schedule;
                // 调度变更时重新计算下次执行时间
                job.state.nextRunAtMs = computeNextRunForJob(job, now);
            }
            if (normalizedPatch.payload !== undefined) job.payload = normalizedPatch.payload;
            if (normalizedPatch.sessionTarget !== undefined) job.sessionTarget = normalizedPatch.sessionTarget;
            if (normalizedPatch.delivery !== undefined) job.delivery = normalizedPatch.delivery;
            if ("failureDestination" in normalizedPatch) job.failureDestination = normalizedPatch.failureDestination;
            job.updatedAtMs = now;

            data.jobs[index] = applyCronJobRuntimeDefaults(job);
            await this.save(data);
            return applyCronJobRuntimeDefaults(job);
        });
    }

    /** 删除任务，返回是否成功 */
    async remove(id: string): Promise<boolean> {
        return this.mutate(async () => {
            const data = await this.load();
            const before = data.jobs.length;
            data.jobs = data.jobs.filter((j) => j.id !== id);
            if (data.jobs.length === before) return false;
            await this.save(data);
            return true;
        });
    }

    /** 批量更新状态（调度器 tick 后调用）；传入 baseJobs 时在锁内 rebase runtime snapshot。 */
    async saveJobs(jobs: CronJob[], baseJobs?: CronJob[]): Promise<void> {
        await this.mutate(async () => {
            const normalizedJobs = jobs.map((job) => applyCronJobRuntimeDefaults(job));
            if (!baseJobs) {
                await this.save({ version: 1, jobs: normalizedJobs });
                return;
            }
            const latest = await this.load();
            await this.save({
                version: 1,
                jobs: rebaseRuntimeJobs(latest.jobs, baseJobs, normalizedJobs),
            });
        });
    }

    // ── 内部方法 ──

    private async load(): Promise<CronStoreFile> {
        try {
            const content = await fs.readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(content) as CronStoreFile;
            // 基本校验
            if (parsed.version === 1 && Array.isArray(parsed.jobs)) {
                return {
                    version: 1,
                    jobs: parsed.jobs.map((job) => applyCronJobRuntimeDefaults(job)),
                };
            }
        } catch {
            // 文件不存在或格式错误，返回空列表
        }
        return { version: 1, jobs: [] };
    }

    private async save(data: CronStoreFile): Promise<void> {
        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true });
        // 原子写入：先写临时文件再 rename
        const tmpPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
        try {
            await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
            await fs.rename(tmpPath, this.filePath);
        } finally {
            await fs.unlink(tmpPath).catch(() => {});
        }
    }

    private async mutate<T>(mutation: () => Promise<T>): Promise<T> {
        return withCronStoreMutationLock(this.filePath, mutation);
    }
}

function rebaseRuntimeJobs(
    latestJobs: CronJob[],
    baseJobs: CronJob[],
    runtimeJobs: CronJob[],
): CronJob[] {
    const baseById = new Map(baseJobs.map((job) => [job.id, job]));
    const runtimeById = new Map(runtimeJobs.map((job) => [job.id, job]));
    const rebased: CronJob[] = [];

    for (const latestJob of latestJobs) {
        const baseJob = baseById.get(latestJob.id);
        if (!baseJob) {
            // scheduler 读取快照后新增的 job 不属于本轮 runtime 结果，必须保留。
            rebased.push(applyCronJobRuntimeDefaults(latestJob));
            continue;
        }

        const runtimeJob = runtimeById.get(latestJob.id);
        if (!runtimeJob) {
            // 仅当管理员未改动该 job 定义时，才应用 at/deleteAfterRun 的删除结果。
            if (!hasCronJobDefinitionChanged(latestJob, baseJob)) {
                continue;
            }
            rebased.push(applyCronJobRuntimeDefaults(latestJob));
            continue;
        }

        // 管理员在 scheduler 运行期间改过定义时，最新配置（含 nextRunAt）优先于旧运行快照。
        rebased.push(applyCronJobRuntimeDefaults(
            hasCronJobDefinitionChanged(latestJob, baseJob) ? latestJob : runtimeJob,
        ));
    }

    return rebased;
}

function hasCronJobDefinitionChanged(left: CronJob, right: CronJob): boolean {
    return JSON.stringify(toCronJobDefinition(left)) !== JSON.stringify(toCronJobDefinition(right));
}

function toCronJobDefinition(job: CronJob): Omit<CronJob, "state" | "updatedAtMs"> {
    const { state: _state, updatedAtMs: _updatedAtMs, ...definition } = job;
    return definition;
}

// ── 调度计算 ──

function parseTimeOfDay(time: string): { hour: number; minute: number } | null {
    const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
    if (!match) return null;
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }
    return { hour, minute };
}

function toLocalTupleMs(parts: LocalDateTimeParts): number {
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function addDaysToLocalDate(date: LocalDateParts, days: number): LocalDateParts {
    const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    };
}

function getZonedDateTimeParts(timestampMs: number, timeZone: string): ZonedDateTimeParts | null {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            weekday: "short",
            hourCycle: "h23",
        }).formatToParts(new Date(timestampMs));

        const lookup: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== "literal") {
                lookup[part.type] = part.value;
            }
        }

        const weekday = WEEKDAY_MAP[lookup.weekday];
        const year = Number.parseInt(lookup.year ?? "", 10);
        const month = Number.parseInt(lookup.month ?? "", 10);
        const day = Number.parseInt(lookup.day ?? "", 10);
        const hour = Number.parseInt(lookup.hour ?? "", 10);
        const minute = Number.parseInt(lookup.minute ?? "", 10);

        if (!weekday || !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)
            || !Number.isFinite(hour) || !Number.isFinite(minute)) {
            return null;
        }

        return {
            year,
            month,
            day,
            hour,
            minute,
            weekday,
        };
    } catch {
        return null;
    }
}

function resolveZonedLocalTimeToUtcMs(target: LocalDateTimeParts, timeZone: string): number | undefined {
    let guess = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);

    for (let i = 0; i < 6; i += 1) {
        const actual = getZonedDateTimeParts(guess, timeZone);
        if (!actual) return undefined;
        const diffMinutes = Math.round((toLocalTupleMs(target) - toLocalTupleMs(actual)) / MINUTE_MS);
        if (diffMinutes === 0) {
            return guess;
        }
        guess += diffMinutes * MINUTE_MS;
    }

    const final = getZonedDateTimeParts(guess, timeZone);
    if (!final) return undefined;
    if (toLocalTupleMs(final) !== toLocalTupleMs(target)) {
        return undefined;
    }
    return guess;
}

function normalizeWeekdays(weekdays: number[]): number[] | null {
    if (!Array.isArray(weekdays) || weekdays.length === 0) {
        return null;
    }
    const unique = new Set<number>();
    for (const weekday of weekdays) {
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || unique.has(weekday)) {
            return null;
        }
        unique.add(weekday);
    }
    return Array.from(unique).sort((a, b) => a - b);
}

/** 计算下次执行时间 */
export function computeNextRun(schedule: CronJob["schedule"], nowMs: number): number | undefined {
    if (schedule.kind === "at") {
        const atMs = new Date(schedule.at).getTime();
        if (!Number.isFinite(atMs)) return undefined;
        // 如果目标时间已过，仍返回（scheduler 会执行一次后 disable）
        return atMs > nowMs ? atMs : nowMs;
    }

    if (schedule.kind === "every") {
        const everyMs = Math.max(MINUTE_MS, Math.floor(schedule.everyMs)); // 最小 1 分钟
        const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
        if (nowMs < anchor) return anchor;
        const elapsed = nowMs - anchor;
        const steps = Math.ceil(elapsed / everyMs);
        return anchor + steps * everyMs;
    }

    if (schedule.kind === "dailyAt") {
        const time = parseTimeOfDay(schedule.time);
        if (!time) return undefined;
        const nowLocal = getZonedDateTimeParts(nowMs, schedule.timezone);
        if (!nowLocal) return undefined;

        const todayTarget = resolveZonedLocalTimeToUtcMs({
            year: nowLocal.year,
            month: nowLocal.month,
            day: nowLocal.day,
            hour: time.hour,
            minute: time.minute,
        }, schedule.timezone);
        if (todayTarget !== undefined && todayTarget > nowMs) {
            return todayTarget;
        }

        const nextDate = addDaysToLocalDate(nowLocal, 1);
        return resolveZonedLocalTimeToUtcMs({
            ...nextDate,
            hour: time.hour,
            minute: time.minute,
        }, schedule.timezone);
    }

    if (schedule.kind === "weeklyAt") {
        const time = parseTimeOfDay(schedule.time);
        const weekdays = normalizeWeekdays(schedule.weekdays);
        if (!time || !weekdays) return undefined;
        const nowLocal = getZonedDateTimeParts(nowMs, schedule.timezone);
        if (!nowLocal) return undefined;

        for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
            const weekday = ((nowLocal.weekday - 1 + dayOffset) % 7) + 1;
            if (!weekdays.includes(weekday)) {
                continue;
            }
            const targetDate = addDaysToLocalDate(nowLocal, dayOffset);
            const targetMs = resolveZonedLocalTimeToUtcMs({
                ...targetDate,
                hour: time.hour,
                minute: time.minute,
            }, schedule.timezone);
            if (targetMs !== undefined && targetMs > nowMs) {
                return targetMs;
            }
        }

        return undefined;
    }

    // 未来扩展 cron 表达式时在此添加
    return undefined;
}

export function computeNextRunForJob(job: Pick<CronJob, "id" | "schedule">, nowMs: number): number | undefined {
    if (job.schedule.kind === "at") {
        return computeNextRun(job.schedule, nowMs);
    }
    const staggerMs = normalizeCronStaggerMs((job.schedule as { staggerMs?: unknown }).staggerMs) ?? 0;
    if (staggerMs <= 0) {
        return computeNextRun(job.schedule, nowMs);
    }

    const offsetMs = resolveStableCronOffsetMs(job.id, staggerMs);
    let cursorMs = Math.max(0, nowMs - offsetMs);
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const baseNext = computeNextRun(job.schedule, cursorMs);
        if (baseNext === undefined) return undefined;
        const shifted = baseNext + offsetMs;
        if (shifted > nowMs) return shifted;
        cursorMs = Math.max(baseNext + 1, cursorMs + 1);
    }
    return undefined;
}

const STAGGER_OFFSET_CACHE_MAX = 4096;
const staggerOffsetCache = new Map<string, number>();

function resolveStableCronOffsetMs(jobId: string, staggerMs: number): number {
    if (staggerMs <= 1) return 0;
    const cacheKey = `${staggerMs}:${jobId}`;
    const cached = staggerOffsetCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const digest = crypto.createHash("sha256").update(jobId).digest();
    const offset = digest.readUInt32BE(0) % staggerMs;
    if (staggerOffsetCache.size >= STAGGER_OFFSET_CACHE_MAX) {
        const first = staggerOffsetCache.keys().next();
        if (!first.done) staggerOffsetCache.delete(first.value);
    }
    staggerOffsetCache.set(cacheKey, offset);
    return offset;
}
