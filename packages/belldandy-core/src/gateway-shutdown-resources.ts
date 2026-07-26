import type { GatewayShutdownCoordinator } from "./gateway-shutdown-coordinator.js";

type StopAndDrainHandle = {
  stop: () => void;
  stopAndDrain: () => Promise<void>;
};

type AsyncStopHandle = {
  stop: () => Promise<void>;
};

type CloseHandle = {
  close: () => void;
};

type AsyncCloseHandle = {
  stop: () => Promise<void>;
};

type DrainHandle = {
  stopAndDrain: () => Promise<void>;
};

export type GatewayShutdownResources = {
  shutdownRequests?: CloseHandle;
  configWatcher?: CloseHandle;
  cron?: StopAndDrainHandle;
  heartbeat?: StopAndDrainHandle;
  memoryIdleSummary?: StopAndDrainHandle;
  dreamAutomation?: StopAndDrainHandle;
  backgroundRuns?: DrainHandle;
  emailInbound?: AsyncStopHandle;
  activeNotify?: CloseHandle;
  channels?: {
    stopChannels: () => Promise<void>;
  };
  shutdownMcp?: () => Promise<void>;
  browserRelay?: AsyncCloseHandle;
  shutdownAgentBridge?: () => Promise<unknown>;
  shutdownCommandJobs?: () => Promise<unknown>;
};

function createDeferredDrain(stop: () => Promise<void>): {
  begin: () => void;
  wait: () => Promise<void>;
} {
  let stopPromise: Promise<void> | undefined;
  const begin = (): void => {
    if (stopPromise) return;
    try {
      // stop() 内部通常先同步撤销 intake/owner，再返回等待活动工作的 promise。
      // 这里立即调用，确保下一 shutdown phase 开始前入口已经关闭。
      stopPromise = Promise.resolve(stop());
    } catch (error) {
      stopPromise = Promise.reject(error);
    }
    // stop_intake 不能等待完整 drain，但必须立即挂 rejection handler，避免延迟到后续
    // phase 前形成未处理拒绝；wait() 仍等待原 promise 并把失败交给协调器。
    void stopPromise.catch(() => undefined);
  };
  return {
    begin,
    wait: () => {
      begin();
      return stopPromise!;
    },
  };
}

/**
 * 只把已有领域 lifecycle seam 映射到 GW04 阶段，不在此模块猜测资源内部状态。
 * 两阶段资源会先同步关闭 intake，再在 drain/close phase 等待同一个 stop promise。
 */
export function registerGatewayShutdownResources(
  coordinator: Pick<GatewayShutdownCoordinator, "register">,
  resources: GatewayShutdownResources,
): void {
  if (resources.shutdownRequests) {
    coordinator.register({
      id: "shutdown-request-owner",
      phase: "stop_intake",
      run: () => resources.shutdownRequests!.close(),
    });
  }
  if (resources.configWatcher) {
    coordinator.register({
      id: "config-watcher",
      phase: "stop_intake",
      run: () => resources.configWatcher!.close(),
    });
  }
  if (resources.cron) {
    coordinator.register({
      id: "cron-intake",
      phase: "stop_intake",
      run: () => resources.cron!.stop(),
    });
  }
  if (resources.heartbeat) {
    coordinator.register({
      id: "heartbeat-intake",
      phase: "stop_intake",
      run: () => resources.heartbeat!.stop(),
    });
  }
  if (resources.memoryIdleSummary) {
    coordinator.register({
      id: "memory-idle-summary-intake",
      phase: "stop_intake",
      run: () => resources.memoryIdleSummary!.stop(),
    });
  }
  if (resources.dreamAutomation) {
    coordinator.register({
      id: "dream-automation-intake",
      phase: "stop_intake",
      run: () => resources.dreamAutomation!.stop(),
    });
  }

  const backgroundRunDrain = resources.backgroundRuns
    ? createDeferredDrain(() => resources.backgroundRuns!.stopAndDrain())
    : undefined;
  if (backgroundRunDrain) {
    coordinator.register({
      id: "background-runs-intake",
      phase: "stop_intake",
      run: backgroundRunDrain.begin,
    });
  }

  const emailDrain = resources.emailInbound
    ? createDeferredDrain(() => resources.emailInbound!.stop())
    : undefined;
  if (emailDrain) {
    coordinator.register({
      id: "email-inbound-intake",
      phase: "stop_intake",
      run: emailDrain.begin,
    });
  }
  if (resources.activeNotify) {
    coordinator.register({
      id: "active-notify-intake",
      phase: "stop_intake",
      run: () => resources.activeNotify!.close(),
    });
  }

  const channelDrain = resources.channels
    ? createDeferredDrain(() => resources.channels!.stopChannels())
    : undefined;
  if (channelDrain) {
    coordinator.register({
      id: "channels-intake",
      phase: "stop_intake",
      run: channelDrain.begin,
    });
  }

  if (resources.shutdownAgentBridge) {
    coordinator.register({
      id: "agent-bridge",
      phase: "abort_active",
      run: async () => {
        await resources.shutdownAgentBridge!();
      },
    });
  }
  if (resources.shutdownCommandJobs) {
    coordinator.register({
      id: "command-jobs",
      phase: "abort_active",
      run: async () => {
        await resources.shutdownCommandJobs!();
      },
    });
  }
  if (resources.cron) {
    coordinator.register({
      id: "cron-drain",
      phase: "drain",
      run: () => resources.cron!.stopAndDrain(),
    });
  }
  if (resources.heartbeat) {
    coordinator.register({
      id: "heartbeat-drain",
      phase: "drain",
      run: () => resources.heartbeat!.stopAndDrain(),
    });
  }
  if (resources.memoryIdleSummary) {
    coordinator.register({
      id: "memory-idle-summary-drain",
      phase: "drain",
      run: () => resources.memoryIdleSummary!.stopAndDrain(),
    });
  }
  if (resources.dreamAutomation) {
    coordinator.register({
      id: "dream-automation-drain",
      phase: "drain",
      run: () => resources.dreamAutomation!.stopAndDrain(),
    });
  }
  if (backgroundRunDrain) {
    coordinator.register({
      id: "background-runs-drain",
      phase: "drain",
      run: backgroundRunDrain.wait,
    });
  }
  if (emailDrain) {
    coordinator.register({
      id: "email-inbound-drain",
      phase: "drain",
      run: emailDrain.wait,
    });
  }

  if (channelDrain) {
    coordinator.register({
      id: "channels",
      phase: "close_external",
      run: channelDrain.wait,
    });
  }
  if (resources.shutdownMcp) {
    coordinator.register({
      id: "mcp",
      phase: "close_external",
      run: resources.shutdownMcp,
    });
  }
  if (resources.browserRelay) {
    coordinator.register({
      id: "browser-relay",
      phase: "close_external",
      run: () => resources.browserRelay!.stop(),
    });
  }
}
