export function createGoalsSpecialistPanelControlsFeature() {
  const groups = new Map();
  let disposed = false;

  function releaseGroup(groupKey, expectedGroup = null) {
    const group = groups.get(groupKey);
    if (!group || (expectedGroup && group !== expectedGroup)) return false;
    groups.delete(groupKey);
    for (const record of group.records) {
      record.target?.removeEventListener("click", record.handler);
      // retained handler 只保留空 record，不继续持有旧 DOM 与业务 callback。
      record.target = null;
      record.onClick = null;
    }
    group.records.length = 0;
    group.panel = null;
    return true;
  }

  function replaceGroup(groupKey, panel, bindings = []) {
    if (disposed || typeof groupKey !== "string" || !groupKey) return false;
    releaseGroup(groupKey);
    if (!panel || typeof panel.querySelectorAll !== "function" || !Array.isArray(bindings)) return false;

    const group = {
      panel,
      records: [],
    };
    groups.set(groupKey, group);
    try {
      for (const binding of bindings) {
        if (!binding?.selector || typeof binding.onClick !== "function") continue;
        const targets = panel.querySelectorAll(binding.selector);
        for (const target of targets) {
          if (!target || typeof target.addEventListener !== "function") continue;
          const record = {
            handler: null,
            onClick: binding.onClick,
            target,
          };
          record.handler = (event) => {
            if (disposed || groups.get(groupKey) !== group || typeof record.onClick !== "function") return;
            record.onClick(record.target, event);
          };
          group.records.push(record);
          target.addEventListener("click", record.handler);
        }
      }
    } catch (error) {
      releaseGroup(groupKey, group);
      throw error;
    }
    if (group.records.length === 0) releaseGroup(groupKey, group);
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const groupKey of [...groups.keys()]) {
      releaseGroup(groupKey);
    }
  }

  function getRuntimeSnapshot() {
    return {
      activeGroupCount: groups.size,
      activeListenerCount: [...groups.values()].reduce((total, group) => total + group.records.length, 0),
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    replaceGroup,
  };
}
