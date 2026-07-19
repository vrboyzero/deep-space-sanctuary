export function createMemoryRuntimeExperienceGenerateAction({
  getState,
  isConnected,
  sendReq,
  makeId,
  getActiveAgentId,
  confirmAction,
  showNotice,
  rerender,
  loadTaskDetail,
  loadCandidateDetail,
  isDraftNoticeEnabled,
  t,
} = {}) {
  const pendingActions = new Set();
  let generation = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && generation === expectedGeneration;
  }

  function formatMatchLabel(match) {
    if (!match || typeof match !== "object") return "";
    return String(match.title || match.key || match.candidateId || "").trim();
  }

  function buildConfirmMessage(result, candidateType) {
    const typeLabel = candidateType === "method"
      ? t("memory.candidateDedupTypeMethod", {}, "method")
      : t("memory.candidateDedupTypeSkill", {}, "skill");
    if (result?.decision === "duplicate_existing") {
      const exactLabel = formatMatchLabel(result.exactMatch);
      return t(
        "memory.candidateDedupDuplicateConfirm",
        { type: typeLabel, target: exactLabel || "-" },
        `检测到已有重复 ${typeLabel} 候选：${exactLabel || "-"}\n\n点击“确定”将直接打开现有候选；点击“取消”则停止本次生成。`,
      );
    }
    if (result?.decision === "similar_existing") {
      const topMatches = Array.isArray(result.similarMatches)
        ? result.similarMatches.slice(0, 3).map(formatMatchLabel).filter(Boolean)
        : [];
      return t(
        "memory.candidateDedupSimilarConfirm",
        { type: typeLabel, targets: topMatches.join(" / ") || "-" },
        `检测到已有相似 ${typeLabel}：${topMatches.join(" / ") || "-"}\n\n点击“确定”继续生成新的候选；点击“取消”则停止本次生成。`,
      );
    }
    return "";
  }

  async function generate(taskId, candidateType) {
    if (disposed) return null;
    if (!isConnected()) {
      showNotice?.(
        t("memory.candidateGenerateUnavailableTitle", {}, "无法生成经验候选"),
        t("memory.disconnectedList", {}, "Not connected to the server."),
        "error",
      );
      return null;
    }

    const normalizedTaskId = typeof taskId === "string" ? taskId.trim() : "";
    const normalizedType = candidateType === "method" || candidateType === "skill" ? candidateType : "";
    if (!normalizedTaskId || !normalizedType) return null;

    const state = getState();
    if (state.pendingExperienceActionKey) return null;
    const actionGeneration = ++generation;
    const pendingKey = `generate:${normalizedType}:${normalizedTaskId}`;
    const token = Symbol("experience-generate");
    state.pendingExperienceActionKey = pendingKey;
    pendingActions.add(token);
    rerender(normalizedTaskId);

    try {
      const duplicateResponse = await sendReq({
        type: "req",
        id: makeId(),
        method: "experience.candidate.check_duplicate",
        params: {
          taskId: normalizedTaskId,
          candidateType: normalizedType,
          agentId: getActiveAgentId(),
        },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!duplicateResponse?.ok) {
        showNotice?.(
          t("memory.candidateDedupCheckFailedTitle", {}, "生成前去重预检失败"),
          duplicateResponse?.error?.message
            || t("memory.candidateDedupCheckFailedMessage", {}, "experience.candidate.check_duplicate 调用失败。"),
          "error",
        );
        return null;
      }
      const duplicateCheck = duplicateResponse.payload ?? null;
      if (!duplicateCheck) return null;
      if (duplicateCheck.decision === "duplicate_existing") {
        const confirmed = confirmAction(buildConfirmMessage(duplicateCheck, normalizedType));
        if (!confirmed || !isCurrent(actionGeneration)) return null;
        if (duplicateCheck.exactMatch?.candidateId) {
          await loadCandidateDetail(duplicateCheck.exactMatch.candidateId);
          if (!isCurrent(actionGeneration)) return null;
          showNotice?.(
            t("memory.candidateDedupOpenedExistingTitle", {}, "已打开现有候选"),
            formatMatchLabel(duplicateCheck.exactMatch)
              || t("memory.candidateGenerateReusedTitle", {}, "已打开现有经验候选"),
            "info",
            2200,
          );
          return state.selectedCandidate ?? null;
        }
      } else if (duplicateCheck.decision === "similar_existing") {
        const confirmed = confirmAction(buildConfirmMessage(duplicateCheck, normalizedType));
        if (!confirmed || !isCurrent(actionGeneration)) return null;
      } else if (duplicateCheck.decision !== "no_match") {
        return null;
      }

      const response = await sendReq({
        type: "req",
        id: makeId(),
        method: "experience.candidate.generate",
        params: {
          taskId: normalizedTaskId,
          candidateType: normalizedType,
          agentId: getActiveAgentId(),
        },
      });
      if (!isCurrent(actionGeneration)) return null;
      if (!response?.ok) {
        showNotice?.(
          t("memory.candidateGenerateFailedTitle", {}, "生成经验候选失败"),
          response?.error?.message
            || t("memory.candidateGenerateFailedMessage", {}, "experience.candidate.generate 调用失败。"),
          "error",
        );
        return null;
      }

      const candidate = response.payload?.candidate ?? null;
      if (response.payload?.reusedExisting || isDraftNoticeEnabled()) {
        const isSkill = normalizedType === "skill";
        showNotice?.(
          response.payload?.reusedExisting
            ? t("memory.candidateGenerateReusedTitle", {}, "已打开现有经验候选")
            : (isSkill
              ? t("memory.skillDraftGenerateSuccessTitle", {}, "Skill Draft 已生成")
              : t("memory.methodDraftGenerateSuccessTitle", {}, "Method Draft 已生成")),
          candidate?.title
            ? String(candidate.title)
            : response.payload?.reusedExisting
              ? t("memory.candidateGenerateSuccessMessage", {}, "已为当前任务准备经验候选。")
              : (isSkill
                ? t("memory.skillDraftGenerateSuccessMessage", {}, "已为当前任务生成新的 Skill Draft。")
                : t("memory.methodDraftGenerateSuccessMessage", {}, "已为当前任务生成新的 Method Draft。")),
          "success",
          2200,
        );
      }

      if (!isCurrent(actionGeneration)) return null;
      await loadTaskDetail(normalizedTaskId);
      if (!isCurrent(actionGeneration)) return null;
      if (candidate?.id) {
        await loadCandidateDetail(candidate.id);
      }
      return isCurrent(actionGeneration) ? candidate : null;
    } catch (error) {
      // dispose 后迟到 rejection 只用于完成物理结算。
      if (!isCurrent(actionGeneration)) return null;
      showNotice?.(
        t("memory.candidateGenerateFailedTitle", {}, "生成经验候选失败"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return null;
    } finally {
      pendingActions.delete(token);
      if (isCurrent(actionGeneration) && state.pendingExperienceActionKey === pendingKey) {
        state.pendingExperienceActionKey = null;
        rerender(normalizedTaskId);
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const state = getState?.();
    if (state && typeof state === "object" && String(state.pendingExperienceActionKey || "").startsWith("generate:")) {
      state.pendingExperienceActionKey = null;
    }
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      memoryRuntimeExperienceGenerateGeneration: generation,
      pendingMemoryRuntimeExperienceGenerateActionCount: pendingActions.size,
    };
  }

  return { dispose, generate, getRuntimeSnapshot };
}
