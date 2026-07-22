import {
  FileMutationLockReleaseError,
  FileMutationLockTimeoutError,
  withFileMutationLock,
  type FileMutationLockOptions,
} from "../file-mutation-lock.js";
import { getGoalsRegistryPath } from "./paths.js";

export type GoalRegistryFileLockOptions = FileMutationLockOptions;

export class GoalRegistryLockTimeoutError extends Error {
  readonly code = "goal_registry_lock_timeout";

  constructor() {
    super("Timed out waiting for the Goal registry mutation lock.");
    this.name = "GoalRegistryLockTimeoutError";
  }
}

export class GoalRegistryLockReleaseError extends Error {
  readonly code = "goal_registry_lock_release_failed";

  constructor() {
    super("Failed to release the Goal registry mutation lock.");
    this.name = "GoalRegistryLockReleaseError";
  }
}

export async function withGoalRegistryFileLock<T>(
  stateDir: string,
  mutation: () => Promise<T>,
  options: GoalRegistryFileLockOptions = {},
): Promise<T> {
  try {
    return await withFileMutationLock(getGoalsRegistryPath(stateDir), mutation, options);
  } catch (error) {
    if (error instanceof FileMutationLockTimeoutError) {
      throw new GoalRegistryLockTimeoutError();
    }
    if (error instanceof FileMutationLockReleaseError) {
      throw new GoalRegistryLockReleaseError();
    }
    throw error;
  }
}
