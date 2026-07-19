import path from "node:path";

const mutationTails = new Map<string, Promise<void>>();

function getMutationKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * 同一 Node 进程内按 Cron Store 文件路径串行 mutation。
 * 仅覆盖进程内读改写，跨进程文件锁仍属于 OPT-GW09 的后续切片。
 */
export async function withCronStoreMutationLock<T>(
  filePath: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const key = getMutationKey(filePath);
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
    return await mutation();
  } finally {
    // 写入失败也必须释放队尾，避免后续 Cron CRUD 永久阻塞。
    releaseCurrent();
  }
}
