import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { FilesystemCapability } from "@belldandy/protocol";

import { getGoalsDocsRoot, getGoalsRoot } from "./paths.js";
import type { LongTermGoal } from "./types.js";

export const GOAL_OWNER_MARKER_FILENAME = ".belldandy-goal-owner.json";

type GoalStorageRootKind = "goal" | "docs";

type GoalOwnerMarker = {
  version: 1;
  goalId: string;
  storageOwnerNonce: string;
  rootKind: GoalStorageRootKind;
};

export type GoalStorageCleanupResult = {
  warnings: string[];
};

export type GoalStorageCleanupPreview = {
  goalId: string;
  roots: Array<{
    rootKind: GoalStorageRootKind;
    action: "remove" | "retain";
    reason?: string;
  }>;
  warnings: string[];
};

function normalizePathForComparison(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function buildOwnerMarker(goal: LongTermGoal, rootKind: GoalStorageRootKind): GoalOwnerMarker {
  if (!goal.storageOwnerNonce) {
    throw new Error(`Goal ${goal.id} is missing a storage owner nonce.`);
  }
  return {
    version: 1,
    goalId: goal.id,
    storageOwnerNonce: goal.storageOwnerNonce,
    rootKind,
  };
}

function getGoalOwnerMarker(goal: LongTermGoal, rootKind: GoalStorageRootKind): GoalOwnerMarker | undefined {
  // 旧 registry 没有 owner nonce，不能倒推其目录归属；保留目录并要求显式迁移。
  if (!goal.storageOwnerNonce) {
    return undefined;
  }
  return buildOwnerMarker(goal, rootKind);
}

function hasMatchingOwnerMarker(
  value: unknown,
  expected: GoalOwnerMarker,
): value is GoalOwnerMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<GoalOwnerMarker>;
  return marker.version === expected.version
    && marker.goalId === expected.goalId
    && marker.storageOwnerNonce === expected.storageOwnerNonce
    && marker.rootKind === expected.rootKind;
}

async function ensureStateDirectoryCapability(stateDir: string): Promise<FilesystemCapability> {
  await fs.mkdir(stateDir, { recursive: true });
  return new FilesystemCapability({
    rootPath: stateDir,
    label: "goal state directory",
  });
}

async function createOwnedStateDirectory(params: {
  stateCapability: FilesystemCapability;
  targetPath: string;
  marker: GoalOwnerMarker;
  label: string;
}): Promise<void> {
  const { stateCapability, targetPath, marker, label } = params;
  const safeParentPath = stateCapability.resolveForWritePath(path.dirname(targetPath), `${label} parent`);
  await fs.mkdir(safeParentPath, { recursive: true });

  const safeTargetPath = stateCapability.resolveForWritePath(targetPath, label);
  if (fsSync.existsSync(safeTargetPath)) {
    throw new Error(`Refusing to create ${label}: target already exists at ${safeTargetPath}`);
  }
  await fs.mkdir(safeTargetPath, { recursive: false });

  const targetCapability = new FilesystemCapability({
    rootPath: safeTargetPath,
    label,
  });
  const markerPath = targetCapability.resolveForWriteRelative(GOAL_OWNER_MARKER_FILENAME, `${label} owner marker`);
  await fs.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

/**
 * 默认 Goal root 与 docs root 都必须在 stateDir 内独占创建并写入 marker。
 * 用户指定的 root 保留现有写入兼容性，但不会获得递归删除权限。
 */
export async function prepareGoalStorageOwnership(params: {
  stateDir: string;
  goal: LongTermGoal;
}): Promise<void> {
  const { stateDir, goal } = params;
  const stateCapability = await ensureStateDirectoryCapability(stateDir);
  const expectedDocsRoot = path.join(getGoalsDocsRoot(stateDir), goal.slug);
  if (!isSamePath(goal.docRoot, expectedDocsRoot)) {
    throw new Error(`Goal ${goal.id} doc root does not match the managed state directory path.`);
  }

  if (goal.pathSource === "default") {
    const expectedGoalRoot = path.join(getGoalsRoot(stateDir), goal.id);
    if (!isSamePath(goal.goalRoot, expectedGoalRoot) || !isSamePath(goal.runtimeRoot, expectedGoalRoot)) {
      throw new Error(`Goal ${goal.id} default root does not match the managed state directory path.`);
    }
    await createOwnedStateDirectory({
      stateCapability,
      targetPath: expectedGoalRoot,
      marker: buildOwnerMarker(goal, "goal"),
      label: `goal root ${goal.id}`,
    });
  } else {
    // 自定义 root 的目录本身不是 Goal 的专属资产，因此只确保运行时可写，删除阶段绝不递归清空它。
    await fs.mkdir(goal.goalRoot, { recursive: true });
  }

  await createOwnedStateDirectory({
    stateCapability,
    targetPath: expectedDocsRoot,
    marker: buildOwnerMarker(goal, "docs"),
    label: `goal docs root ${goal.id}`,
  });
}

async function readOwnerMarker(params: {
  targetPath: string;
  expectedMarker: GoalOwnerMarker;
  label: string;
}): Promise<boolean> {
  const { targetPath, expectedMarker, label } = params;
  const targetCapability = new FilesystemCapability({ rootPath: targetPath, label });
  const markerPath = targetCapability.resolveExistingRelative(GOAL_OWNER_MARKER_FILENAME, `${label} owner marker`);
  const raw = await fs.readFile(markerPath, "utf8");
  return hasMatchingOwnerMarker(JSON.parse(raw), expectedMarker);
}

type OwnedStateDirectoryAssessment = {
  removalAllowed: boolean;
  warning?: string;
};

async function assessOwnedStateDirectory(params: {
  stateCapability: FilesystemCapability;
  configuredPath: string;
  expectedPath: string;
  expectedMarker: GoalOwnerMarker | undefined;
  label: string;
}): Promise<OwnedStateDirectoryAssessment> {
  const {
    stateCapability,
    configuredPath,
    expectedPath,
    expectedMarker,
    label,
  } = params;
  if (!expectedMarker) {
    return {
      removalAllowed: false,
      warning: `Skipped ${label}: legacy goal storage has no owner nonce; recursive deletion requires an explicit migration.`,
    };
  }
  if (!isSamePath(configuredPath, expectedPath)) {
    return {
      removalAllowed: false,
      warning: `Skipped ${label}: registry path is not the managed path.`,
    };
  }

  let safeTargetPath: string;
  try {
    safeTargetPath = stateCapability.resolveForRemovalPath(configuredPath, label);
  } catch (error) {
    return {
      removalAllowed: false,
      warning: `Skipped ${label}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!fsSync.existsSync(safeTargetPath)) {
    return { removalAllowed: true };
  }

  try {
    if (!await readOwnerMarker({ targetPath: safeTargetPath, expectedMarker, label })) {
      return {
        removalAllowed: false,
        warning: `Skipped ${label}: owner marker is missing or does not match this goal.`,
      };
    }
  } catch (error) {
    return {
      removalAllowed: false,
      warning: `Skipped ${label}: owner marker could not be verified (${error instanceof Error ? error.message : String(error)}).`,
    };
  }

  return { removalAllowed: true };
}

async function removeOwnedStateDirectory(params: {
  stateCapability: FilesystemCapability;
  configuredPath: string;
  expectedPath: string;
  expectedMarker: GoalOwnerMarker | undefined;
  label: string;
  warnings: string[];
}): Promise<void> {
  const {
    stateCapability,
    configuredPath,
    expectedPath,
    expectedMarker,
    label,
    warnings,
  } = params;
  const assessment = await assessOwnedStateDirectory({
    stateCapability,
    configuredPath,
    expectedPath,
    expectedMarker,
    label,
  });
  if (!assessment.removalAllowed) {
    warnings.push(assessment.warning!);
    return;
  }

  try {
    // 删除前重新创建 capability 并复读 marker，缩短 parent/root 被替换后的 TOCTOU 窗口。
    const recheckedStateCapability = new FilesystemCapability({
      rootPath: stateCapability.configuredRootPath,
      label: "goal state directory",
    });
    const recheckedTargetPath = recheckedStateCapability.resolveForRemovalPath(configuredPath, label);
    if (!fsSync.existsSync(recheckedTargetPath)) {
      return;
    }
    if (!expectedMarker) {
      warnings.push(`Skipped ${label}: legacy goal storage has no owner nonce; recursive deletion requires an explicit migration.`);
      return;
    }
    if (!await readOwnerMarker({ targetPath: recheckedTargetPath, expectedMarker, label })) {
      warnings.push(`Skipped ${label}: owner marker changed before deletion.`);
      return;
    }
    await fs.rm(recheckedTargetPath, { recursive: true, force: true });
  } catch (error) {
    warnings.push(`Failed to remove ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 预览删除会保留任何无法证明归属的目录，让调用方在确认永久删除前可见迁移或保留原因。
 * 真正删除仍会在 fs.rm 前重新检查 marker 和 canonical path。
 */
export async function previewGoalStorageForDeletion(params: {
  stateDir: string;
  goal: LongTermGoal;
}): Promise<GoalStorageCleanupPreview> {
  const { stateDir, goal } = params;
  const warnings: string[] = [];
  const roots: GoalStorageCleanupPreview["roots"] = [];
  let stateCapability: FilesystemCapability;
  try {
    stateCapability = new FilesystemCapability({
      rootPath: stateDir,
      label: "goal state directory",
    });
  } catch (error) {
    const warning = `Skipped goal storage cleanup: ${error instanceof Error ? error.message : String(error)}`;
    warnings.push(warning);
    roots.push(
      { rootKind: "goal", action: "retain", reason: warning },
      { rootKind: "docs", action: "retain", reason: warning },
    );
    return { goalId: goal.id, roots, warnings };
  }

  const appendOwnedRootPreview = async (params: {
    rootKind: GoalStorageRootKind;
    configuredPath: string;
    expectedPath: string;
    label: string;
  }): Promise<void> => {
    const assessment = await assessOwnedStateDirectory({
      stateCapability,
      configuredPath: params.configuredPath,
      expectedPath: params.expectedPath,
      expectedMarker: getGoalOwnerMarker(goal, params.rootKind),
      label: params.label,
    });
    roots.push({
      rootKind: params.rootKind,
      action: assessment.removalAllowed ? "remove" : "retain",
      ...(assessment.warning ? { reason: assessment.warning } : {}),
    });
    if (assessment.warning) {
      warnings.push(assessment.warning);
    }
  };

  if (goal.pathSource === "default") {
    await appendOwnedRootPreview({
      rootKind: "goal",
      configuredPath: goal.goalRoot,
      expectedPath: path.join(getGoalsRoot(stateDir), goal.id),
      label: `goal root ${goal.id}`,
    });
  } else {
    const warning = `Skipped user-configured goal root for ${goal.id}; recursive deletion requires an explicit migration.`;
    roots.push({ rootKind: "goal", action: "retain", reason: warning });
    warnings.push(warning);
  }

  await appendOwnedRootPreview({
    rootKind: "docs",
    configuredPath: goal.docRoot,
    expectedPath: path.join(getGoalsDocsRoot(stateDir), goal.slug),
    label: `goal docs root ${goal.id}`,
  });

  return { goalId: goal.id, roots, warnings };
}

/**
 * 逻辑删除可以继续移除 registry，但物理递归删除只能作用于本次 Goal 独占创建、且 marker 仍匹配的 stateDir 根。
 */
export async function removeGoalStorageForDeletion(params: {
  stateDir: string;
  goal: LongTermGoal;
}): Promise<GoalStorageCleanupResult> {
  const { stateDir, goal } = params;
  const warnings: string[] = [];
  let stateCapability: FilesystemCapability;
  try {
    stateCapability = new FilesystemCapability({
      rootPath: stateDir,
      label: "goal state directory",
    });
  } catch (error) {
    return {
      warnings: [`Skipped goal storage cleanup: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (goal.pathSource === "default") {
    await removeOwnedStateDirectory({
      stateCapability,
      configuredPath: goal.goalRoot,
      expectedPath: path.join(getGoalsRoot(stateDir), goal.id),
      expectedMarker: getGoalOwnerMarker(goal, "goal"),
      label: `goal root ${goal.id}`,
      warnings,
    });
  } else {
    warnings.push(`Skipped user-configured goal root for ${goal.id}; recursive deletion requires an explicit migration.`);
  }

  await removeOwnedStateDirectory({
    stateCapability,
    configuredPath: goal.docRoot,
    expectedPath: path.join(getGoalsDocsRoot(stateDir), goal.slug),
    expectedMarker: getGoalOwnerMarker(goal, "docs"),
    label: `goal docs root ${goal.id}`,
    warnings,
  });

  return { warnings };
}
