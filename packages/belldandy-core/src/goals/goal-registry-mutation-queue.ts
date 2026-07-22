import path from "node:path";
import { withGoalRegistryFileLock } from "./goal-registry-file-lock.js";

const mutationTails = new Map<string, Promise<void>>();

function getMutationKey(stateDir: string): string {
  const resolved = path.resolve(stateDir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * 按规范化 stateDir 在进程内排队，并在执行 mutation 前取得 Goal registry 跨进程文件锁。
 * 完整 GoalTransaction 与多文件 commit/recovery 仍由后续切片负责。
 */
export async function withGoalRegistryMutationLock<T>(
  stateDir: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const key = getMutationKey(stateDir);
  const predecessor = mutationTails.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = predecessor
    .catch(() => undefined)
    .then(() => current);
  mutationTails.set(key, tail);
  void tail.then(() => {
    if (mutationTails.get(key) === tail) {
      mutationTails.delete(key);
    }
  });

  await predecessor.catch(() => undefined);
  try {
    return await withGoalRegistryFileLock(stateDir, mutation);
  } finally {
    // 无论当前 mutation 成功或失败，都必须唤醒同 stateDir 的下一项。
    releaseCurrent();
  }
}
