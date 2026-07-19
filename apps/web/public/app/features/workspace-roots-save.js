import { createPanelTaskScope } from "./panel-task-scope.js";

export function createWorkspaceRootsSaveFeature({
  button,
  input,
  isConnected,
  persistWorkspaceRoots,
  sendReq,
  makeId,
  invalidateServerConfigCache,
  alertUser,
  t,
}) {
  let buttonState = "default";
  const taskScope = createPanelTaskScope();

  function renderButton() {
    if (!button || !taskScope.isActive()) return;
    const saved = buttonState === "saved";
    const label = document.createElement("u");
    label.textContent = saved
      ? t("common.saved", {}, "Saved")
      : t("common.save", {}, "Save");
    button.replaceChildren(label);
  }

  function showSaveFailure(message) {
    alertUser(t("panel.saveWorkspaceFailed", { message }, "Save failed: {message}"));
  }

  async function save() {
    if (!taskScope.isActive()) return null;
    if (!isConnected()) {
      alertUser(t("panel.saveWorkspaceNotConnected", {}, "Please connect to the server first"));
      return null;
    }

    const value = input ? input.value.trim() : "";
    persistWorkspaceRoots();
    const requestTask = taskScope.beginTask();
    if (!requestTask) return null;
    let response;
    try {
      response = await sendReq({
        type: "req",
        id: makeId(),
        method: "config.update",
        params: { updates: { BELLDANDY_EXTRA_WORKSPACE_ROOTS: value } },
      }, {
        signal: requestTask.signal,
      });
    } catch (error) {
      requestTask.commit(() => {
        showSaveFailure(error instanceof Error ? error.message : String(error));
      });
      return null;
    } finally {
      requestTask.settle();
    }

    // Scope 同时校验激活代次和最新任务，迟到结果不得更新当前面板。
    if (!requestTask.isCurrent()) return response;
    if (response?.ok) {
      invalidateServerConfigCache();
      buttonState = "saved";
      renderButton();
      taskScope.replaceTimeout("save-feedback", () => {
        if (!requestTask.isCurrent()) return;
        buttonState = "default";
        renderButton();
      }, 1_500);
      return response;
    }

    const message = response?.error?.message || t("settings.failed", {}, "Failed");
    showSaveFailure(message);
    return response;
  }

  function handleSaveClick() {
    void save();
  }

  function activate() {
    if (!taskScope.activate()) return false;
    taskScope.addEventListener(button, "click", handleSaveClick);
    renderButton();
    return true;
  }

  function deactivate() {
    if (!taskScope.isActive()) return false;
    buttonState = "default";
    renderButton();
    return taskScope.deactivate();
  }

  function dispose() {
    if (taskScope.getRuntimeSnapshot().disposed) return false;
    buttonState = "default";
    renderButton();
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      activeTimerCount: snapshot.activeTimerCount,
      pendingRequestCount: snapshot.pendingTaskCount,
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
    refreshLocale: renderButton,
    save,
  };
}
