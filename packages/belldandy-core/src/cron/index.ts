/**
 * Cron 模块导出
 */

export { CronStore, computeNextRun, computeNextRunForJob } from "./store.js";
export {
    applyCronJobRuntimeDefaults,
    normalizeCronJobCreateInput,
    normalizeCronJobPatchInput,
    normalizeCronStaggerMs,
} from "./validation.js";
export {
    startCronScheduler,
    type CronGoalApprovalScanResult,
    type CronRunExecutionContext,
    type CronSchedulerOptions,
    type CronSchedulerHandle,
    type CronSchedulerStatus,
} from "./scheduler.js";
export {
    buildCronRuntimeDoctorReport,
    type CronRuntimeDoctorJobSummary,
    type CronRuntimeDoctorReport,
} from "./observability.js";
export type {
    CronJob,
    CronJobCreate,
    CronJobPatch,
    CronSchedule,
    CronScheduleAt,
    CronScheduleEvery,
    CronScheduleDailyAt,
    CronScheduleWeeklyAt,
    CronPayload,
    CronSystemEventPayload,
    CronGoalApprovalScanPayload,
    CronSessionTarget,
    CronDelivery,
    CronDeliveryMode,
    CronFailureDestination,
    CronFailureDestinationMode,
    CronJobState,
    CronJobStatus,
    CronStoreFile,
} from "./types.js";
