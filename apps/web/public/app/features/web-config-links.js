import { createPanelTaskScope } from "./panel-task-scope.js";

export function applyWebConfigLinks(refs = {}, webConfig = {}) {
  const linkMappings = [
    [refs.recommendApiLink, webConfig.recommendApiUrl],
    [refs.aliyunOneKeyLink, webConfig.aliyunOneKeyUrl],
    [refs.officialHomeLink, webConfig.officialHomeUrl],
    [refs.workshopLink, webConfig.workshopUrl],
  ];
  const taskScope = createPanelTaskScope();

  function activate() {
    if (!taskScope.activate()) return false;
    for (const [element, href] of linkMappings) {
      if (!element || !href) continue;
      const resolvedHref = String(href).trim();
      if (!resolvedHref) continue;
      element.href = resolvedHref;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
      taskScope.addEventListener(element, "click", (event) => {
        if (!taskScope.isActive()) return;
        event.preventDefault();
        window.open(resolvedHref, "_blank", "noopener,noreferrer");
      });
    }
    return true;
  }

  function deactivate() {
    return taskScope.deactivate();
  }

  function dispose() {
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      listenerCount: snapshot.listenerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
  };
}
