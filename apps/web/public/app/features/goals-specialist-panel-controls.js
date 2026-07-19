import { createPanelTaskScope } from "./panel-task-scope.js";

export function createGoalsSpecialistPanelControlsFeature() {
  const groups = new Map();
  const taskScope = createPanelTaskScope();

  function releaseGroup(groupKey, expectedGroup = null) {
    const group = groups.get(groupKey);
    if (!group || (expectedGroup && group !== expectedGroup)) return false;
    groups.delete(groupKey);
    group.taskScope.dispose();
    for (const record of group.records) {
      // retained handler 只保留空 record，不继续持有旧 DOM 与业务 callback。
      record.target = null;
      record.onClick = null;
    }
    group.records.length = 0;
    group.panel = null;
    return true;
  }

  function replaceGroup(groupKey, panel, bindings = []) {
    if (!taskScope.isActive() || typeof groupKey !== "string" || !groupKey) return false;
    releaseGroup(groupKey);
    if (!panel || typeof panel.querySelectorAll !== "function" || !Array.isArray(bindings)) return false;

    const group = {
      panel,
      records: [],
      // 每组独立持有 listener，replacement 不会扰动其他已激活 group。
      taskScope: createPanelTaskScope(),
    };
    group.taskScope.activate();
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
            if (!taskScope.isActive()
              || !group.taskScope.isActive()
              || groups.get(groupKey) !== group
              || typeof record.onClick !== "function") return;
            record.onClick(record.target, event);
          };
          group.records.push(record);
          group.taskScope.addEventListener(target, "click", record.handler);
        }
      }
    } catch (error) {
      releaseGroup(groupKey, group);
      throw error;
    }
    if (group.records.length === 0) releaseGroup(groupKey, group);
    return true;
  }

  function releaseAllGroups() {
    for (const groupKey of [...groups.keys()]) {
      releaseGroup(groupKey);
    }
  }

  function activate() {
    if (!taskScope.activate()) return false;
    releaseAllGroups();
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    releaseAllGroups();
    return true;
  }

  function dispose() {
    if (!taskScope.dispose()) return false;
    releaseAllGroups();
    return true;
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      activeGroupCount: groups.size,
      activeListenerCount: [...groups.values()].reduce(
        (total, group) => total + group.taskScope.getRuntimeSnapshot().listenerCount,
        0,
      ),
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
    replaceGroup,
  };
}
