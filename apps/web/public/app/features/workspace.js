import { createWorkspaceTreePlaceholderView } from "./workspace-tree-placeholder-view.js";
import { createWorkspaceTreeItemView } from "./workspace-tree-item-view.js";

function createReq(sendReq, makeId, method, params) {
  return sendReq({
    type: "req",
    id: makeId(),
    method,
    params,
  });
}

function setSidebarActionButtonState(button, active) {
  if (!button) return;
  button.classList.toggle("is-active", Boolean(active));
}

function summarizeCronWorkspaceContent(content) {
  if (typeof content !== "string" || !content.trim()) return null;
  try {
    const parsed = JSON.parse(content);
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    const summary = {
      totalJobs: jobs.length,
      enabledJobs: 0,
      mainSessionJobs: 0,
      isolatedSessionJobs: 0,
      staggeredJobs: 0,
    };
    for (const job of jobs) {
      if (job?.enabled === true) {
        summary.enabledJobs += 1;
      }
      if (job?.sessionTarget === "main") {
        summary.mainSessionJobs += 1;
      } else if (job?.sessionTarget === "isolated") {
        summary.isolatedSessionJobs += 1;
      }
      const schedule = job?.schedule;
      const staggerMs = schedule && typeof schedule === "object" ? schedule.staggerMs : undefined;
      if (typeof staggerMs === "number" && Number.isFinite(staggerMs) && staggerMs > 0) {
        summary.staggeredJobs += 1;
      }
    }
    return summary;
  } catch {
    return null;
  }
}

function buildWorkspaceEditorLabel(filePath, content) {
  if (filePath !== "cron-jobs.json") {
    return filePath;
  }
  const summary = summarizeCronWorkspaceContent(content);
  if (!summary) {
    return filePath;
  }
  return `${filePath} · ${summary.totalJobs} jobs · ${summary.enabledJobs} enabled · main ${summary.mainSessionJobs} / isolated ${summary.isolatedSessionJobs} · stagger ${summary.staggeredJobs}`;
}

function findLineNumberByMatch(content, options = {}) {
  if (typeof content !== "string" || !content) {
    return null;
  }
  const { findText, findPattern } = options;
  if (typeof findText !== "string" && !(findPattern instanceof RegExp) && typeof findPattern !== "string") {
    return null;
  }

  const lines = content.split("\n");
  const matcher = findPattern instanceof RegExp
    ? findPattern
    : typeof findPattern === "string" && findPattern
      ? new RegExp(findPattern)
      : null;

  const matchedIndex = lines.findIndex((line) => {
    if (typeof findText === "string" && findText && line.includes(findText)) {
      return true;
    }
    if (matcher) {
      matcher.lastIndex = 0;
      return matcher.test(line);
    }
    return false;
  });

  return matchedIndex >= 0 ? matchedIndex + 1 : null;
}

function findSelectionRange(content, options = {}) {
  if (typeof content !== "string" || !content) {
    return null;
  }
  const { findText, findPattern } = options;
  if (typeof findText === "string" && findText) {
    const start = content.indexOf(findText);
    if (start >= 0) {
      return {
        start,
        end: start + findText.length,
      };
    }
  }
  if (findPattern instanceof RegExp) {
    findPattern.lastIndex = 0;
    const match = findPattern.exec(content);
    if (match && typeof match.index === "number") {
      return {
        start: match.index,
        end: match.index + match[0].length,
      };
    }
    return null;
  }
  if (typeof findPattern === "string" && findPattern) {
    const matcher = new RegExp(findPattern);
    const match = matcher.exec(content);
    if (match && typeof match.index === "number") {
      return {
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  }
  return null;
}

export function createWorkspaceFeature({
  refs,
  keys,
  isConnected,
  sendReq,
  makeId,
  switchMode,
  showNotice,
  loadServerConfig,
  syncAttachmentLimitsFromConfig,
  persistWorkspaceRootsField,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    sidebarEl,
    sidebarTitleEl,
    fileTreeEl,
    refreshTreeBtn,
    editorPathEl,
    editorModeBadgeEl,
    editorTextareaEl,
    cancelEditBtn,
    saveEditBtn,
    openEnvEditorBtn,
    switchRootBtn,
    switchFacetBtn,
    switchCronBtn,
    workspaceRootsEl,
  } = refs;
  const { workspaceRootsKey } = keys;
  const treePlaceholderView = createWorkspaceTreePlaceholderView({ t });
  const treeItemView = createWorkspaceTreeItemView({
    ownerDocument: fileTreeEl?.ownerDocument ?? document,
  });

  let sidebarExpanded = !sidebarEl?.classList.contains("hidden");
  let currentEditPath = null;
  let originalContent = null;
  let currentEditReadOnly = false;
  let currentTreeMode = "root";
  let editRevision = 0;
  let saveFinalizeTimer = null;
  let disposed = false;
  const expandedFolders = new Set();
  let lastRootTreePlaceholder = {
    key: "common.loading",
    fallback: "Loading...",
  };

  function clearSaveFinalizeTimer() {
    if (saveFinalizeTimer === null) return;
    clearTimeout(saveFinalizeTimer);
    saveFinalizeTimer = null;
  }

  function invalidateEditorSettlement() {
    const hadFinalizeTimer = saveFinalizeTimer !== null;
    editRevision += 1;
    clearSaveFinalizeTimer();
    if (saveEditBtn && (hadFinalizeTimer || saveEditBtn.disabled)) {
      saveEditBtn.disabled = currentEditReadOnly;
      saveEditBtn.textContent = currentEditReadOnly
        ? t("editor.readonly", {}, "Read-only")
        : t("common.save", {}, "Save");
      saveEditBtn.title = currentEditReadOnly
        ? t("editor.readonlySaveTitle", {}, "This source view is read-only.")
        : "";
    }
    return editRevision;
  }

  if (refreshTreeBtn) {
    refreshTreeBtn.addEventListener("click", () => {
      void loadFileTree();
    });
  }
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => cancelEdit());
  }
  if (saveEditBtn) {
    saveEditBtn.addEventListener("click", () => {
      void saveFile();
    });
  }
  if (openEnvEditorBtn) {
    openEnvEditorBtn.addEventListener("click", () => {
      void openEnvFile();
    });
  }
  if (switchRootBtn) {
    switchRootBtn.addEventListener("click", () => switchTreeMode("root"));
  }
  if (switchFacetBtn) {
    switchFacetBtn.addEventListener("click", () => switchTreeMode("facets"));
  }
  if (switchCronBtn) {
    switchCronBtn.addEventListener("click", () => switchTreeMode("cron"));
  }

  updateSidebarTitle();

  function getTreeMode() {
    return currentTreeMode;
  }

  function isSidebarExpanded() {
    return sidebarExpanded;
  }

  function isSidebarVisible() {
    return !sidebarEl?.classList.contains("hidden");
  }

  function refreshAfterConnectionReady() {
    if (isSidebarVisible()) {
      void loadFileTree();
    }
  }

  function setRootTreePlaceholder(key, fallback) {
    lastRootTreePlaceholder = { key, fallback };
    treePlaceholderView.render(fileTreeEl, key, fallback);
  }

  async function loadWorkspaceRootsFromServer() {
    if (!isConnected()) return;

    const config = await loadServerConfig?.();
    if (!config) return;
    syncAttachmentLimitsFromConfig?.(config);
    const serverValue = config.BELLDANDY_EXTRA_WORKSPACE_ROOTS;
    if (workspaceRootsEl && serverValue && serverValue !== "[REDACTED]") {
      workspaceRootsEl.value = serverValue;
      persistWorkspaceRootsField?.({ workspaceRootsKey, workspaceRootsEl });
    }
  }

  function handleSidebarVisibilityChange(visible) {
    sidebarExpanded = Boolean(visible);
    if (visible && isConnected()) {
      void loadFileTree();
    }
  }

  function toggleSidebar(forceVisible) {
    const nextVisible = typeof forceVisible === "boolean"
      ? forceVisible
      : !isSidebarVisible();
    if (!sidebarEl) return nextVisible;
    sidebarEl.classList.toggle("hidden", !nextVisible);
    handleSidebarVisibilityChange(nextVisible);
    return nextVisible;
  }

  function switchTreeMode(mode) {
    if (currentTreeMode === mode) {
      if (isSidebarVisible()) {
        void loadFileTree();
      }
      switchMode("chat");
      return;
    }

    currentTreeMode = mode;
    expandedFolders.clear();
    updateSidebarTitle();
    switchMode("chat");

    if (isSidebarVisible()) {
      void loadFileTree();
    }
  }

  function applyEditorSession({ path, content, readOnly = false, label, startLine, selectionStart, selectionEnd }) {
    currentEditPath = path;
    originalContent = content;
    currentEditReadOnly = readOnly;

    if (editorPathEl) {
      editorPathEl.textContent = label || path || t("editor.pathLabel", {}, "File path");
    }
    if (editorTextareaEl) {
      editorTextareaEl.value = content || "";
      editorTextareaEl.readOnly = readOnly;
    }
    if (editorModeBadgeEl) {
      editorModeBadgeEl.classList.toggle("hidden", !readOnly);
      editorModeBadgeEl.textContent = readOnly
        ? t("editor.readonlySource", {}, "Read-only source")
        : t("editor.editable", {}, "Editable");
    }
    if (saveEditBtn) {
      saveEditBtn.disabled = readOnly;
      saveEditBtn.textContent = readOnly ? t("editor.readonly", {}, "Read-only") : t("common.save", {}, "Save");
      saveEditBtn.title = readOnly ? t("editor.readonlySaveTitle", {}, "This source view is read-only.") : "";
    }

    switchMode("editor");
    if (
      editorTextareaEl
      && typeof selectionStart === "number"
      && selectionStart >= 0
      && typeof selectionEnd === "number"
      && selectionEnd >= selectionStart
    ) {
      editorTextareaEl.focus();
      editorTextareaEl.setSelectionRange(selectionStart, selectionEnd);
      const lineHeight = parseFloat(getComputedStyle(editorTextareaEl).lineHeight || "22");
      const prefix = editorTextareaEl.value.slice(0, selectionStart);
      const lineNumber = prefix.split("\n").length;
      editorTextareaEl.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
      return;
    }
    if (typeof startLine === "number" && startLine > 0) {
      focusEditorLine(startLine);
    }
  }

  function focusEditorLine(lineNumber) {
    if (!editorTextareaEl || typeof lineNumber !== "number" || lineNumber <= 0) return;
    const lines = editorTextareaEl.value.split("\n");
    const safeLine = Math.max(1, Math.min(lineNumber, lines.length));
    let offset = 0;
    for (let i = 0; i < safeLine - 1; i += 1) {
      offset += lines[i].length + 1;
    }
    const lineText = lines[safeLine - 1] || "";
    editorTextareaEl.focus();
    editorTextareaEl.setSelectionRange(offset, offset + lineText.length);
    const lineHeight = parseFloat(getComputedStyle(editorTextareaEl).lineHeight || "22");
    editorTextareaEl.scrollTop = Math.max(0, (safeLine - 3) * lineHeight);
  }

  function resetEditorAccessState() {
    currentEditReadOnly = false;
    if (editorTextareaEl) {
      editorTextareaEl.readOnly = false;
    }
    if (editorModeBadgeEl) {
      editorModeBadgeEl.classList.add("hidden");
      editorModeBadgeEl.textContent = t("editor.readonlySource", {}, "Read-only source");
    }
    if (saveEditBtn) {
      saveEditBtn.disabled = false;
      saveEditBtn.textContent = t("common.save", {}, "Save");
      saveEditBtn.title = "";
    }
  }

  async function openEnvFile() {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(t("editor.openConfigFailedTitle", {}, "Unable to open config"), t("editor.notConnected", {}, "Not connected to the server."), "error");
      return;
    }
    invalidateEditorSettlement();

    const res = await createReq(sendReq, makeId, "config.readRaw");
    if (!res || !res.ok) {
      const msg = res?.error?.message || t("editor.readFailed", {}, "Read failed");
      showNotice(t("editor.openConfigReadFailedTitle", {}, "Unable to read config file"), msg, "error");
      return;
    }

    applyEditorSession({
      path: ".env",
      content: typeof res.payload?.content === "string" ? res.payload.content : "",
      readOnly: false,
      label: t("editor.envLabel", {}, ".env (environment config)"),
    });
  }

  async function loadFileTree(folderPath = "") {
    if (!isConnected()) {
      if (fileTreeEl && !folderPath) {
        setRootTreePlaceholder("sidebar.disconnected", "Disconnected");
      }
      return [];
    }

    const resolvedPath = currentTreeMode === "facets" && !folderPath ? "facets" : folderPath;
    const res = await createReq(sendReq, makeId, "workspace.list", {
      path: resolvedPath,
    });

    if (!res || !res.ok || !Array.isArray(res.payload?.items)) {
      if (fileTreeEl && !folderPath) {
        setRootTreePlaceholder("sidebar.loadFailed", "Load failed");
      }
      return [];
    }

    let items = res.payload.items;
    if (currentTreeMode === "cron" && !folderPath) {
      const cronTargets = new Set(["HEARTBEAT.md", "cron-jobs.json"]);
      items = items.filter((item) => item?.type === "file" && cronTargets.has(item.name));
    }
    if (!folderPath) {
      renderFileTree(items);
    }
    return items;
  }

  function updateSidebarTitle() {
    if (!sidebarTitleEl) return;
    if (currentTreeMode === "facets") {
      sidebarTitleEl.textContent = t("sidebar.facetFiles", {}, "模组文件");
      return;
    }
    if (currentTreeMode === "cron") {
      sidebarTitleEl.textContent = t("sidebar.cronFiles", {}, "定时任务文件");
      return;
    }
    sidebarTitleEl.textContent = t("sidebar.fileList", {}, "文件列表");
  }

  function renderFileTree(items) {
    if (!fileTreeEl) return;

    fileTreeEl.textContent = "";
    if (!Array.isArray(items) || items.length === 0) {
      setRootTreePlaceholder("sidebar.noFiles", "No files");
      return;
    }
    lastRootTreePlaceholder = null;

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      fragment.appendChild(createTreeItem(item));
    }
    fileTreeEl.appendChild(fragment);
  }

  function createTreeItem(item) {
    if (item.type === "directory") {
      const expanded = expandedFolders.has(item.path);
      const { element, trigger, children } = treeItemView.createDirectory(item, { expanded });
      trigger.addEventListener("click", () => {
        void toggleFolder(item.path, element);
      });
      if (expanded) {
        void loadFolderChildren(item.path, children);
      }
      return element;
    }

    const { element, trigger } = treeItemView.createFile(item, {
      active: currentEditPath === item.path,
    });
    trigger.addEventListener("click", () => {
      void openFile(item.path);
    });
    return element;
  }

  async function toggleFolder(folderPath, folderEl) {
    if (expandedFolders.has(folderPath)) {
      expandedFolders.delete(folderPath);
      folderEl.classList.remove("expanded");
      return;
    }

    expandedFolders.add(folderPath);
    folderEl.classList.add("expanded");

    const children = folderEl.querySelector(".tree-children");
    if (children && children.children.length === 0) {
      await loadFolderChildren(folderPath, children);
    }
  }

  async function loadFolderChildren(folderPath, containerEl) {
    treePlaceholderView.render(containerEl, "sidebar.loading", "Loading...", { compact: true });
    const items = await loadFileTree(folderPath);
    containerEl.textContent = "";

    if (!items || items.length === 0) {
      treePlaceholderView.render(containerEl, "sidebar.empty", "Empty", { compact: true, muted: true });
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      fragment.appendChild(createTreeItem(item));
    }
    containerEl.appendChild(fragment);
  }

  async function openFile(filePath, options = {}) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(t("editor.openFileFailedTitle", {}, "Unable to open file"), t("editor.notConnected", {}, "Not connected to the server."), "error");
      return;
    }
    invalidateEditorSettlement();

    const res = await createReq(sendReq, makeId, "workspace.read", { path: filePath });
    if (!res || !res.ok) {
      const msg = res?.error?.message || t("editor.readFailed", {}, "Read failed");
      showNotice(t("editor.openFileReadFailedTitle", {}, "Unable to read file"), msg, "error");
      return;
    }

    const content = typeof res.payload?.content === "string" ? res.payload.content : "";
    const startLine = typeof options.startLine === "number" && options.startLine > 0
      ? options.startLine
      : findLineNumberByMatch(content, options);
    const selection = findSelectionRange(content, options);

    applyEditorSession({
      path: filePath,
      content,
      readOnly: false,
      label: buildWorkspaceEditorLabel(
        filePath,
        content,
      ),
      startLine,
      selectionStart: selection?.start,
      selectionEnd: selection?.end,
    });
    if (filePath === "cron-jobs.json") {
      const summary = summarizeCronWorkspaceContent(content);
      if (summary) {
        showNotice(
          t("editor.cronSummaryTitle", {}, "Cron Summary"),
          t(
            "editor.cronSummaryMessage",
            {
              totalJobs: String(summary.totalJobs),
              enabledJobs: String(summary.enabledJobs),
              mainSessionJobs: String(summary.mainSessionJobs),
              isolatedSessionJobs: String(summary.isolatedSessionJobs),
              staggeredJobs: String(summary.staggeredJobs),
            },
            `${summary.totalJobs} jobs total, ${summary.enabledJobs} enabled, main ${summary.mainSessionJobs} / isolated ${summary.isolatedSessionJobs}, staggered ${summary.staggeredJobs}.`,
          ),
          "info",
          2600,
        );
      }
    }
    void loadFileTree();
  }

  async function openSourcePath(sourcePath, options = {}) {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(t("editor.openSourceFailedTitle", {}, "Unable to open source file"), t("editor.notConnected", {}, "Not connected to the server."), "error");
      return;
    }
    if (!sourcePath || typeof sourcePath !== "string") {
      showNotice(t("editor.openSourceFailedTitle", {}, "Unable to open source file"), t("editor.invalidSourcePath", {}, "Invalid source path."), "error");
      return;
    }
    invalidateEditorSettlement();

    const res = await createReq(sendReq, makeId, "workspace.readSource", { path: sourcePath });
    if (!res || !res.ok) {
      const msg = res?.error?.message || t("editor.readFailed", {}, "Read failed");
      showNotice(t("editor.openSourceFailedTitle", {}, "Unable to open source file"), msg, "error", 4200);
      return;
    }

    const resolvedPath = res.payload?.path || sourcePath;
    applyEditorSession({
      path: resolvedPath,
      content: typeof res.payload?.content === "string" ? res.payload.content : "",
      readOnly: true,
      label: t("editor.sourceReadonlyLabel", { path: resolvedPath }, `${resolvedPath} (read-only source)`),
      startLine: options.startLine,
    });
    showNotice(t("editor.sourceOpenedTitle", {}, "Source file opened"), t("editor.sourceOpenedMessage", {}, "This is a read-only view and will not write back to the original file."), "info", 2600);
  }

  async function readSourceFile(sourcePath) {
    if (!isConnected()) return null;
    if (!sourcePath || typeof sourcePath !== "string") return null;

    const res = await createReq(sendReq, makeId, "workspace.readSource", { path: sourcePath });
    if (!res || !res.ok) return null;
    return {
      path: res.payload?.path || sourcePath,
      content: typeof res.payload?.content === "string" ? res.payload.content : "",
    };
  }

  async function saveFile() {
    if (disposed) return;
    if (!isConnected()) {
      showNotice(t("editor.cannotSaveTitle", {}, "Unable to save"), t("editor.notConnected", {}, "Not connected to the server."), "error");
      return;
    }
    if (currentEditReadOnly) {
      showNotice(t("editor.readonlySaveTitle", {}, "Save unavailable"), t("editor.readonlySaveMessage", {}, "This is a read-only source view and cannot be written back directly."), "error");
      return;
    }
    if (!currentEditPath) {
      showNotice(t("editor.cannotSaveTitle", {}, "Unable to save"), t("editor.noActiveFileMessage", {}, "There is no active file being edited."), "error");
      return;
    }

    clearSaveFinalizeTimer();
    const revision = ++editRevision;
    const editPath = currentEditPath;
    const content = editorTextareaEl ? editorTextareaEl.value : "";
    if (saveEditBtn) {
      saveEditBtn.textContent = t("editor.saving", {}, "Saving...");
      saveEditBtn.disabled = true;
    }

    const method = editPath === ".env" ? "config.writeRaw" : "workspace.write";
    const params = editPath === ".env"
      ? { content }
      : { path: editPath, content };
    const res = await createReq(sendReq, makeId, method, params);

    // 新 editor session 或 pagehide 已接管 UI 时，旧保存响应只能静默结算。
    if (disposed || revision !== editRevision) return;

    if (saveEditBtn) {
      saveEditBtn.disabled = false;
    }

    if (!res || !res.ok) {
      if (saveEditBtn) {
        saveEditBtn.textContent = t("common.save", {}, "Save");
      }
      const msg = res?.error?.message || t("editor.saveFailed", {}, "Save failed");
      showNotice(t("editor.saveFailedTitle", {}, "Save failed"), msg, "error");
      return;
    }

    if (saveEditBtn) {
      saveEditBtn.textContent = t("common.saved", {}, "Saved");
    }
    showNotice(
      t("editor.saveSuccessTitle", {}, "Saved"),
      t("editor.saveSuccessMessage", { path: editPath }, `${editPath} was written.`),
      "success",
      1800,
    );

    saveFinalizeTimer = setTimeout(() => {
      saveFinalizeTimer = null;
      if (disposed || revision !== editRevision) return;
      if (saveEditBtn) {
        saveEditBtn.textContent = t("common.save", {}, "Save");
      }
      switchMode("chat");
      currentEditPath = null;
      originalContent = null;
      resetEditorAccessState();
      editRevision += 1;
      void loadFileTree();
    }, 500);
  }

  function cancelEdit() {
    if (disposed) return;
    if (originalContent !== null && editorTextareaEl) {
      if (editorTextareaEl.value !== originalContent && !confirm(t("editor.discardConfirm", {}, "Discard changes?"))) {
        return;
      }
    }

    invalidateEditorSettlement();
    switchMode("chat");
    currentEditPath = null;
    originalContent = null;
    resetEditorAccessState();
    void loadFileTree();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    invalidateEditorSettlement();
  }

  function getRuntimeSnapshot() {
    return {
      saveFinalizeTimerActive: saveFinalizeTimer !== null,
      editRevision,
      disposed,
    };
  }

  return {
    cancelEdit,
    dispose,
    getTreeMode,
    getRuntimeSnapshot,
    handleSidebarVisibilityChange,
    isSidebarExpanded,
    loadFileTree,
    loadWorkspaceRootsFromServer,
    openEnvFile,
    openFile,
    openSourcePath,
    readSourceFile,
    refreshLocale() {
      updateSidebarTitle();
      if (lastRootTreePlaceholder && fileTreeEl) {
        treePlaceholderView.render(
          fileTreeEl,
          lastRootTreePlaceholder.key,
          lastRootTreePlaceholder.fallback,
        );
      }
    },
    refreshAfterConnectionReady,
    saveFile,
    switchTreeMode,
    toggleSidebar,
  };
}

export { setSidebarActionButtonState };
