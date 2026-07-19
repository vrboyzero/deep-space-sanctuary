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
  let feedbackTimer = null;
  let requestRevision = 0;
  let pendingRequestCount = 0;
  let disposed = false;

  function renderButton() {
    if (!button || disposed) return;
    const saved = buttonState === "saved";
    const label = document.createElement("u");
    label.textContent = saved
      ? t("common.saved", {}, "Saved")
      : t("common.save", {}, "Save");
    button.replaceChildren(label);
  }

  function clearFeedbackTimer() {
    if (feedbackTimer === null) return;
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }

  function showSaveFailure(message) {
    alertUser(t("panel.saveWorkspaceFailed", { message }, "Save failed: {message}"));
  }

  async function save() {
    if (disposed) return null;
    if (!isConnected()) {
      alertUser(t("panel.saveWorkspaceNotConnected", {}, "Please connect to the server first"));
      return null;
    }

    const value = input ? input.value.trim() : "";
    persistWorkspaceRoots();
    const revision = ++requestRevision;
    pendingRequestCount += 1;
    let response;
    try {
      response = await sendReq({
        type: "req",
        id: makeId(),
        method: "config.update",
        params: { updates: { BELLDANDY_EXTRA_WORKSPACE_ROOTS: value } },
      });
    } catch (error) {
      if (!disposed && revision === requestRevision) {
        showSaveFailure(error instanceof Error ? error.message : String(error));
      }
      return null;
    } finally {
      pendingRequestCount = Math.max(0, pendingRequestCount - 1);
    }

    // 请求可以在页面退出或后续保存之后才结算，只允许当前代次更新可见 UI。
    if (disposed || revision !== requestRevision) return response;
    if (response?.ok) {
      invalidateServerConfigCache();
      buttonState = "saved";
      renderButton();
      clearFeedbackTimer();
      feedbackTimer = setTimeout(() => {
        feedbackTimer = null;
        if (disposed || revision !== requestRevision) return;
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

  button?.addEventListener("click", handleSaveClick);
  renderButton();

  function dispose() {
    if (disposed) return;
    disposed = true;
    requestRevision += 1;
    clearFeedbackTimer();
    button?.removeEventListener("click", handleSaveClick);
    buttonState = "default";
  }

  function getRuntimeSnapshot() {
    return {
      activeTimerCount: feedbackTimer === null ? 0 : 1,
      pendingRequestCount,
      listenerCount: disposed || !button ? 0 : 1,
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    refreshLocale: renderButton,
    save,
  };
}
