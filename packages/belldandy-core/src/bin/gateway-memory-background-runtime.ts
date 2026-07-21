import { MemoryModelPrivacyRuntime } from "@belldandy/memory";

import type { BackgroundRunClaimCoordinator } from "../background-run-coordinator.js";
import { MemoryBackgroundJobScheduler } from "../memory-background-job-scheduler.js";
import {
  MemoryRuntimeBudgetGuard,
  MemoryRuntimeUsageAccounting,
} from "../memory-runtime-budget.js";

export type GatewayMemoryBackgroundRuntime = {
  usageAccounting: MemoryRuntimeUsageAccounting;
  budgetGuard: MemoryRuntimeBudgetGuard;
  jobScheduler: MemoryBackgroundJobScheduler;
  modelPrivacyRuntime: MemoryModelPrivacyRuntime;
};

export async function createGatewayMemoryBackgroundRuntime(input: {
  stateDir: string;
  runCoordinator: BackgroundRunClaimCoordinator;
  logger?: {
    warn?: (message: string, data?: unknown) => void;
  };
  env?: NodeJS.ProcessEnv;
}): Promise<GatewayMemoryBackgroundRuntime> {
  const usageAccounting = new MemoryRuntimeUsageAccounting({
    stateDir: input.stateDir,
    logger: input.logger,
  });
  await usageAccounting.load();
  const budgetGuard = MemoryRuntimeBudgetGuard.fromEnv(usageAccounting);
  const jobScheduler = new MemoryBackgroundJobScheduler({
    runCoordinator: input.runCoordinator,
    budgetGuard,
    usageAccounting,
  });
  const modelPrivacyRuntime = MemoryModelPrivacyRuntime.fromEnv(input.env);
  return {
    usageAccounting,
    budgetGuard,
    jobScheduler,
    modelPrivacyRuntime,
  };
}
