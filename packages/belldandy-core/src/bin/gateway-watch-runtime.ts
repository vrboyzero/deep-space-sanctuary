import fs from "node:fs";
import path from "node:path";

import type { BelldandyLogger } from "../logger/index.js";
import { isConfigFileRestartSuppressed } from "../config-restart-guard.js";

type GatewayConfigWatch = (
  targetPath: fs.PathLike,
  listener: (eventType: string, fileName: string | Buffer | null) => void,
) => fs.FSWatcher;

export type GatewayConfigWatcherHandle = {
  close: () => void;
};

export function startGatewayConfigWatcher(input: {
  envDir: string;
  envPath: string;
  envLocalPath: string;
  logger: Pick<BelldandyLogger, "info">;
  onRestartRequired: (fileName: string) => void;
  debounceMs?: number;
  watch?: GatewayConfigWatch;
}): GatewayConfigWatcherHandle {
  const watchFiles = new Set([
    path.basename(input.envPath),
    path.basename(input.envLocalPath),
  ]);
  const debounceMs = input.debounceMs ?? 1500;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  const watchers: fs.FSWatcher[] = [];
  let closed = false;
  const watch = input.watch ?? fs.watch;

  const triggerRestart = (fileName: string) => {
    if (closed) return;
    if (isConfigFileRestartSuppressed(fileName)) {
      return;
    }
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (closed) return;
      input.onRestartRequired(fileName);
    }, debounceMs);
  };

  try {
    watchers.push(watch(input.envDir, (eventType: string, fileName: string | Buffer | null) => {
      const normalizedFileName = typeof fileName === "string" ? fileName : fileName?.toString();
      if (normalizedFileName && watchFiles.has(normalizedFileName) && (eventType === "rename" || eventType === "change")) {
        triggerRestart(normalizedFileName);
      }
    }));
    input.logger.info("config-watcher", "监听 .env 变更");
    input.logger.info("config-watcher", "监听 .env.local 变更");
  } catch {
    for (const name of watchFiles) {
      const envFile = path.join(input.envDir, name);
      try {
        if (fs.existsSync(envFile)) {
          watchers.push(watch(envFile, (eventType) => {
            if (eventType === "change") triggerRestart(name);
          }));
        }
      } catch {
        // ignore fallback errors
      }
    }
  }

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // 单个 watcher 已关闭时继续释放其余 handle。
        }
      }
      watchers.length = 0;
    },
  };
}
