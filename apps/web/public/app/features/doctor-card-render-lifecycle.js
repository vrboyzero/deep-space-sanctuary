function createDefaultScheduler(container) {
  const view = container?.ownerDocument?.defaultView;
  if (view && typeof view.requestAnimationFrame === "function" && typeof view.cancelAnimationFrame === "function") {
    return {
      schedule: (callback) => view.requestAnimationFrame(callback),
      cancel: (handle) => view.cancelAnimationFrame(handle),
    };
  }
  return {
    schedule: (callback) => setTimeout(callback, 0),
    cancel: (handle) => clearTimeout(handle),
  };
}

export function createDoctorCardRenderLifecycle({
  syncBatchSize = 4,
  asyncBatchSize = 4,
  createScheduler = createDefaultScheduler,
} = {}) {
  const jobsByContainer = new Map();
  let disposed = false;

  function releaseJob(container, job) {
    if (!job || job.cancelled) return false;
    job.cancelled = true;
    if (jobsByContainer.get(container) === job) jobsByContainer.delete(container);
    if (job.handle !== null) {
      job.scheduler.cancel(job.handle);
      job.handle = null;
    }
    // 清空未渲染卡片引用，避免取消后的 Doctor 正文继续被 pending frame 持有。
    job.pendingItems.splice(0);
    job.createNode = null;
    return true;
  }

  function disposeContainer(container) {
    return releaseJob(container, jobsByContainer.get(container));
  }

  function render({ container, items, createNode } = {}) {
    if (disposed || !container || !Array.isArray(items) || typeof createNode !== "function") return false;
    disposeContainer(container);
    if (items.length === 0) return true;

    const job = {
      cancelled: false,
      container,
      createNode,
      handle: null,
      pendingItems: [...items],
      scheduler: createScheduler(container),
    };
    jobsByContainer.set(container, job);

    const appendBatch = (batchSize) => {
      if (job.cancelled || disposed || jobsByContainer.get(container) !== job) return;
      const batch = job.pendingItems.splice(0, batchSize);
      try {
        for (const item of batch) {
          container.appendChild(job.createNode(item));
        }
      } catch (error) {
        releaseJob(container, job);
        throw error;
      }

      if (job.pendingItems.length === 0) {
        releaseJob(container, job);
        return;
      }
      job.handle = job.scheduler.schedule(() => {
        if (job.cancelled || disposed || jobsByContainer.get(container) !== job) return;
        job.handle = null;
        appendBatch(asyncBatchSize);
      });
    };

    appendBatch(syncBatchSize);
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [container, job] of [...jobsByContainer.entries()]) {
      releaseJob(container, job);
    }
  }

  function getRuntimeSnapshot(container = null) {
    const jobs = container
      ? [jobsByContainer.get(container)].filter(Boolean)
      : [...jobsByContainer.values()];
    return {
      disposed,
      pendingDoctorCardRenderJobCount: jobs.length,
      activeDoctorCardRenderFrameCount: jobs.filter((job) => job.handle !== null).length,
      retainedDoctorCardItemCount: jobs.reduce((total, job) => total + job.pendingItems.length, 0),
    };
  }

  return {
    dispose,
    disposeContainer,
    getRuntimeSnapshot,
    render,
  };
}
