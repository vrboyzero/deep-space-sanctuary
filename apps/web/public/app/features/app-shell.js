function setSidebarActionButtonState(button, active) {
  if (!button) return;
  button.classList.toggle("is-active", Boolean(active));
}

function ensureNoticeStack() {
  let stack = document.getElementById("noticeStack");
  if (stack) return stack;
  stack = document.createElement("div");
  stack.id = "noticeStack";
  stack.className = "notice-stack";
  document.body.appendChild(stack);
  return stack;
}

export function createAppShellFeature({
  refs,
  getTreeMode,
  subtasksState,
  reopenLinkedSession,
  renderCanvasGoalContext,
}) {
  const {
    switchRootBtn,
    switchFacetBtn,
    switchCronBtn,
    switchMemoryBtn,
    switchExperienceBtn,
    switchGoalsBtn,
    switchSubtasksBtn,
    switchCanvasBtn,
    chatSection,
    editorSection,
    memoryViewerSection,
    experienceWorkbenchSection,
    goalsSection,
    subtasksSection,
    bridgeSection,
    composerSection,
    editorActions,
  } = refs;

  function updateSidebarModeButtons(treeModeOverride) {
    const treeMode = treeModeOverride ?? getTreeMode?.() ?? "root";
    setSidebarActionButtonState(switchRootBtn, treeMode === "root");
    setSidebarActionButtonState(switchFacetBtn, treeMode === "facets");
    setSidebarActionButtonState(switchCronBtn, treeMode === "cron");
    setSidebarActionButtonState(switchMemoryBtn, memoryViewerSection && !memoryViewerSection.classList.contains("hidden"));
    setSidebarActionButtonState(switchExperienceBtn, experienceWorkbenchSection && !experienceWorkbenchSection.classList.contains("hidden"));
    setSidebarActionButtonState(switchGoalsBtn, goalsSection && !goalsSection.classList.contains("hidden"));
    setSidebarActionButtonState(switchSubtasksBtn, subtasksSection && !subtasksSection.classList.contains("hidden"));
    const canvasSection = document.getElementById("canvasSection");
    setSidebarActionButtonState(switchCanvasBtn, canvasSection && !canvasSection.classList.contains("hidden"));
  }

  function showNotice(title, message, tone = "info", durationMs = 3200, options = {}) {
    const stack = ensureNoticeStack();
    const item = document.createElement("div");
    item.className = `notice-item notice-${tone}`;
    item.setAttribute("role", "alert");
    const remove = () => {
      if (item.parentElement) item.parentElement.removeChild(item);
    };
    const titleEl = document.createElement("div");
    titleEl.className = "notice-title";
    titleEl.textContent = String(title ?? "");
    const messageEl = document.createElement("div");
    messageEl.className = "notice-message";
    messageEl.textContent = String(message ?? "");
    item.appendChild(titleEl);
    item.appendChild(messageEl);
    if (options?.dismissible !== false) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "notice-close-btn";
      closeBtn.setAttribute("aria-label", "Close notice");
      closeBtn.textContent = "×";
      closeBtn.addEventListener("click", remove);
      item.appendChild(closeBtn);
    }
    const actionLabel = typeof options?.actionLabel === "string" ? options.actionLabel.trim() : "";
    if (actionLabel) {
      const actionsEl = document.createElement("div");
      actionsEl.className = "notice-actions";
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "button button-muted notice-action-btn";
      actionBtn.textContent = actionLabel;
      actionBtn.addEventListener("click", () => {
        options.onAction?.();
        remove();
      });
      actionsEl.appendChild(actionBtn);
      item.appendChild(actionsEl);
    }
    stack.appendChild(item);
    if (Number.isFinite(durationMs) && durationMs > 0) {
      setTimeout(remove, durationMs);
    }
  }

  function switchMode(mode) {
    const canvasSection = document.getElementById("canvasSection");
    const wasSubtasksVisible = Boolean(subtasksSection && !subtasksSection.classList.contains("hidden"));

    if (mode === "editor") {
      if (chatSection) chatSection.classList.add("hidden");
      if (editorSection) editorSection.classList.remove("hidden");
      if (canvasSection) canvasSection.classList.add("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.add("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.add("hidden");
      if (goalsSection) goalsSection.classList.add("hidden");
      if (subtasksSection) subtasksSection.classList.add("hidden");
      if (bridgeSection) bridgeSection.classList.add("hidden");
      if (composerSection) composerSection.classList.add("hidden");
      if (editorActions) editorActions.classList.remove("hidden");
    } else if (mode === "canvas") {
      if (chatSection) chatSection.classList.add("hidden");
      if (editorSection) editorSection.classList.add("hidden");
      if (canvasSection) canvasSection.classList.remove("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.add("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.add("hidden");
      if (goalsSection) goalsSection.classList.add("hidden");
      if (subtasksSection) subtasksSection.classList.add("hidden");
      if (bridgeSection) bridgeSection.classList.add("hidden");
      if (composerSection) composerSection.classList.add("hidden");
      if (editorActions) editorActions.classList.add("hidden");
    } else if (mode === "memory") {
      if (chatSection) chatSection.classList.add("hidden");
      if (editorSection) editorSection.classList.add("hidden");
      if (canvasSection) canvasSection.classList.add("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.remove("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.add("hidden");
      if (goalsSection) goalsSection.classList.add("hidden");
      if (subtasksSection) subtasksSection.classList.add("hidden");
      if (bridgeSection) bridgeSection.classList.add("hidden");
      if (composerSection) composerSection.classList.add("hidden");
      if (editorActions) editorActions.classList.add("hidden");
    } else if (mode === "experience") {
      if (chatSection) chatSection.classList.add("hidden");
      if (editorSection) editorSection.classList.add("hidden");
      if (canvasSection) canvasSection.classList.add("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.add("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.remove("hidden");
      if (goalsSection) goalsSection.classList.add("hidden");
      if (subtasksSection) subtasksSection.classList.add("hidden");
      if (bridgeSection) bridgeSection.classList.add("hidden");
      if (composerSection) composerSection.classList.add("hidden");
      if (editorActions) editorActions.classList.add("hidden");
    } else if (mode === "goals") {
      if (chatSection) chatSection.classList.add("hidden");
      if (editorSection) editorSection.classList.add("hidden");
      if (canvasSection) canvasSection.classList.add("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.add("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.add("hidden");
      if (goalsSection) goalsSection.classList.remove("hidden");
      if (subtasksSection) subtasksSection.classList.add("hidden");
      if (bridgeSection) bridgeSection.classList.add("hidden");
      if (composerSection) composerSection.classList.add("hidden");
      if (editorActions) editorActions.classList.add("hidden");
    } else if (mode === "subtasks") {
      if (chatSection) chatSection.classList.add("hidden");
      if (editorSection) editorSection.classList.add("hidden");
      if (canvasSection) canvasSection.classList.add("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.add("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.add("hidden");
      if (goalsSection) goalsSection.classList.add("hidden");
      if (subtasksSection) subtasksSection.classList.remove("hidden");
      if (bridgeSection) bridgeSection.classList.add("hidden");
      if (composerSection) composerSection.classList.add("hidden");
      if (editorActions) editorActions.classList.add("hidden");
    } else if (mode === "bridge") {
      if (chatSection) chatSection.classList.add("hidden");
      if (editorSection) editorSection.classList.add("hidden");
      if (canvasSection) canvasSection.classList.add("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.add("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.add("hidden");
      if (goalsSection) goalsSection.classList.add("hidden");
      if (subtasksSection) subtasksSection.classList.add("hidden");
      if (bridgeSection) bridgeSection.classList.remove("hidden");
      if (composerSection) composerSection.classList.add("hidden");
      if (editorActions) editorActions.classList.add("hidden");
    } else {
      if (wasSubtasksVisible && subtasksState.linkedSessionContext?.sessionId) {
        reopenLinkedSession?.(subtasksState.linkedSessionContext.sessionId);
      }
      if (chatSection) chatSection.classList.remove("hidden");
      if (editorSection) editorSection.classList.add("hidden");
      if (canvasSection) canvasSection.classList.add("hidden");
      if (memoryViewerSection) memoryViewerSection.classList.add("hidden");
      if (experienceWorkbenchSection) experienceWorkbenchSection.classList.add("hidden");
      if (goalsSection) goalsSection.classList.add("hidden");
      if (subtasksSection) subtasksSection.classList.add("hidden");
      if (bridgeSection) bridgeSection.classList.add("hidden");
      if (composerSection) composerSection.classList.remove("hidden");
      if (editorActions) editorActions.classList.add("hidden");
    }

    updateSidebarModeButtons();
    if (mode === "canvas") {
      renderCanvasGoalContext?.();
    }
  }

  return {
    showNotice,
    switchMode,
    updateSidebarModeButtons,
  };
}
