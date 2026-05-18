import { buildLaunchExplainabilityLines } from "./agent-launch-explainability.js";
import { buildResidentStateBindingLines } from "./resident-state-binding-lines.js";

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}

function renderDetailCard(label, value, escapeHtml) {
  return `
    <div class="memory-detail-card">
      <span class="memory-detail-label">${escapeHtml(label)}</span>
      <div class="memory-detail-text">${escapeHtml(value || "-")}</div>
    </div>
  `;
}

function renderExplainabilityBlock(lines, escapeHtml) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  return `
    <div class="tool-settings-policy-note">
      ${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
    </div>
  `;
}

function extractMessagePreview(message) {
  if (!message || typeof message !== "object") return "-";
  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        if (part.type === "text" && typeof part.text === "string") return part.text.trim();
        if (typeof part.type === "string") return `[${part.type}]`;
        return "";
      })
      .filter(Boolean);
    return parts.join(" ").trim() || "-";
  }
  return typeof message.content === "string" && message.content.trim()
    ? message.content.trim()
    : "-";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim()))];
}

function normalizeInlineString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function collectActiveSectionIds(snapshotArtifact) {
  const blocks = Array.isArray(snapshotArtifact?.providerNativeSystemBlocks)
    ? snapshotArtifact.providerNativeSystemBlocks
    : [];
  return [...new Set(blocks.flatMap((block) => normalizeStringArray(block?.sourceSectionIds)))];
}

function collectDeltaSummaries(snapshotArtifact) {
  const deltas = Array.isArray(snapshotArtifact?.deltas) ? snapshotArtifact.deltas : [];
  return deltas
    .map((delta) => {
      if (!delta || typeof delta !== "object") return "";
      const deltaType = typeof delta.deltaType === "string" && delta.deltaType.trim()
        ? delta.deltaType.trim()
        : "delta";
      const deltaId = typeof delta.id === "string" && delta.id.trim()
        ? delta.id.trim()
        : "";
      return deltaId ? `${deltaType} (${deltaId})` : deltaType;
    })
    .filter(Boolean);
}

function collectProviderBlockSummaries(snapshotArtifact) {
  const blocks = Array.isArray(snapshotArtifact?.providerNativeSystemBlocks)
    ? snapshotArtifact.providerNativeSystemBlocks
    : [];
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const blockType = typeof block.blockType === "string" && block.blockType.trim()
        ? block.blockType.trim()
        : "provider-block";
      const sectionIds = normalizeStringArray(block.sourceSectionIds);
      const deltaIds = normalizeStringArray(block.sourceDeltaIds);
      const parts = [
        blockType,
        sectionIds.length ? `sections=${sectionIds.join("+")}` : "",
        deltaIds.length ? `deltas=${deltaIds.join("+")}` : "",
      ].filter(Boolean);
      return parts.join(", ");
    })
    .filter(Boolean);
}

function collectFollowUpStrategySummaries(snapshotArtifact) {
  const deltas = Array.isArray(snapshotArtifact?.deltas) ? snapshotArtifact.deltas : [];
  const summaries = [];
  const seen = new Set();
  const pushSummary = (value) => {
    const normalized = normalizeInlineString(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    summaries.push(normalized);
  };

  for (const delta of deltas) {
    if (!delta || typeof delta !== "object") continue;
    const deltaType = normalizeInlineString(delta.deltaType) || "delta";
    const metadata = delta.metadata && typeof delta.metadata === "object" ? delta.metadata : null;
    const delegationResult = metadata?.delegationResult && typeof metadata.delegationResult === "object"
      ? metadata.delegationResult
      : null;
    const followUpStrategy = delegationResult?.followUpStrategy && typeof delegationResult.followUpStrategy === "object"
      ? delegationResult.followUpStrategy
      : null;
    if (!followUpStrategy) continue;

    const summary = normalizeInlineString(followUpStrategy.summary);
    if (summary) {
      pushSummary(`${deltaType}: ${summary}`);
    }

    const detailParts = [];
    const recommendedRuntimeAction = normalizeInlineString(followUpStrategy.recommendedRuntimeAction);
    const highPriorityLabels = normalizeStringArray(followUpStrategy.highPriorityLabels);
    const verifierHandoffLabels = normalizeStringArray(followUpStrategy.verifierHandoffLabels);
    if (recommendedRuntimeAction) detailParts.push(`runtime=${recommendedRuntimeAction}`);
    if (highPriorityLabels.length) detailParts.push(`high=${highPriorityLabels.join(" | ")}`);
    if (verifierHandoffLabels.length) detailParts.push(`verifier_handoff=${verifierHandoffLabels.join(" | ")}`);
    if (detailParts.length) {
      pushSummary(`${deltaType}: ${detailParts.join("; ")}`);
    }

    const items = Array.isArray(followUpStrategy.items)
      ? followUpStrategy.items
      : (Array.isArray(followUpStrategy.itemsPreview) ? followUpStrategy.itemsPreview : []);
    for (const item of items.slice(0, 3)) {
      if (!item || typeof item !== "object") continue;
      const label = normalizeInlineString(item.label);
      const action = normalizeInlineString(item.action);
      if (!label || !action) continue;
      const runtimeAction = normalizeInlineString(item.recommendedRuntimeAction);
      const priority = normalizeInlineString(item.priority);
      const itemSummary = `${label}: ${action}${runtimeAction ? ` -> ${runtimeAction}` : ""}${priority ? ` [${priority}]` : ""}`;
      pushSummary(itemSummary);
    }

    const itemCount = Number.isFinite(Number(followUpStrategy.itemCount))
      ? Math.max(0, Number(followUpStrategy.itemCount))
      : items.length;
    if (itemCount > items.length) {
      pushSummary(`${deltaType}: +${itemCount - items.length} more follow-up items`);
    } else if (items.length > 3) {
      pushSummary(`${deltaType}: +${items.length - 3} more follow-up items`);
    }
  }

  return summaries;
}

function collectTeamCoordinationSummaries(snapshotArtifact) {
  const activeSectionIds = collectActiveSectionIds(snapshotArtifact)
    .filter((sectionId) => sectionId.startsWith("team-") || sectionId === "manager-fanout-fanin-policy");
  const deltas = Array.isArray(snapshotArtifact?.deltas) ? snapshotArtifact.deltas : [];
  const summaries = [];
  const seen = new Set();
  const pushSummary = (value) => {
    const normalized = normalizeInlineString(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    summaries.push(normalized);
  };

  if (activeSectionIds.length) {
    pushSummary(`sections=${activeSectionIds.join(" | ")}`);
  }

  for (const delta of deltas) {
    if (!delta || typeof delta !== "object") continue;
    const deltaType = normalizeInlineString(delta.deltaType);
    if (!deltaType || !deltaType.startsWith("team-")) continue;
    const deltaId = normalizeInlineString(delta.id);
    pushSummary(deltaId ? `${deltaType} (${deltaId})` : deltaType);

    const metadata = delta.metadata && typeof delta.metadata === "object" ? delta.metadata : null;
    const completionGate = metadata?.completionGate && typeof metadata.completionGate === "object"
      ? metadata.completionGate
      : null;
    if (completionGate) {
      const status = normalizeInlineString(completionGate.status);
      const verdict = normalizeInlineString(completionGate.finalFanInVerdict);
      const summary = normalizeInlineString(completionGate.summary);
      if (status || verdict) {
        pushSummary(`completion_gate=${status || "-"}${verdict ? `; verdict=${verdict}` : ""}`);
      }
      if (summary) {
        pushSummary(`completion_gate_summary=${summary}`);
      }
    }
  }

  return summaries;
}

function collectIdentityAuthoritySummaries(snapshotArtifact) {
  const deltas = Array.isArray(snapshotArtifact?.deltas) ? snapshotArtifact.deltas : [];
  const summaries = [];
  const seen = new Set();
  const pushSummary = (value) => {
    const normalized = normalizeInlineString(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    summaries.push(normalized);
  };

  for (const delta of deltas) {
    if (!delta || typeof delta !== "object") continue;
    const deltaType = normalizeInlineString(delta.deltaType);
    if (deltaType !== "runtime-identity-authority") continue;
    const metadata = delta.metadata && typeof delta.metadata === "object" ? delta.metadata : null;
    pushSummary("runtime-identity-authority");
    const mode = normalizeInlineString(metadata?.authorityMode);
    const relation = normalizeInlineString(metadata?.actorRelation);
    const action = normalizeInlineString(metadata?.recommendedAction);
    const label = normalizeInlineString(metadata?.currentLabel);
    const teamId = normalizeInlineString(metadata?.teamId);
    if (mode || relation || action) {
      pushSummary(`mode=${mode || "-"}; relation=${relation || "-"}; action=${action || "-"}`);
    }
    if (label) {
      pushSummary(`current_label=${label}`);
    }
    if (teamId) {
      pushSummary(`team_id=${teamId}`);
    }
  }

  return summaries;
}

function renderSummaryListBlock(title, items, escapeHtml) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `
    <div class="memory-detail-text"><strong>${escapeHtml(title)}</strong></div>
    <div class="tool-settings-policy-note">
      ${items.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
    </div>
  `;
}

export function renderPromptSnapshotDetail(view, helpers) {
  const {
    escapeHtml,
    formatDateTime,
    t = (_key, _params, fallback) => fallback ?? "",
    sessionId = "",
  } = helpers;
  const snapshot = view?.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    if (!sessionId) return "";
    return `
      <section class="memory-detail-card" data-subtask-prompt-snapshot-session="${escapeHtml(sessionId)}">
        <span class="memory-detail-label">${escapeHtml(t("subtasks.detailPromptSnapshot", {}, "Prompt Snapshot"))}</span>
        <div class="memory-detail-text">${escapeHtml(t("subtasks.detailPromptSnapshotMissing", {}, "This subtask session has no persisted prompt snapshot yet."))}</div>
      </section>
    `;
  }

  const summary = snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};
  const manifest = snapshot.manifest && typeof snapshot.manifest === "object" ? snapshot.manifest : {};
  const artifact = snapshot.snapshot && typeof snapshot.snapshot === "object" ? snapshot.snapshot : {};
  const residentStateBindingLines = buildResidentStateBindingLines(view?.residentStateBinding, t);
  const launchExplainabilityLines = buildLaunchExplainabilityLines(view?.launchExplainability, t);
  const messages = Array.isArray(artifact.messages) ? artifact.messages : [];
  const activeSectionIds = collectActiveSectionIds(artifact);
  const deltaSummaries = collectDeltaSummaries(artifact);
  const providerBlockSummaries = collectProviderBlockSummaries(artifact);
  const followUpStrategySummaries = collectFollowUpStrategySummaries(artifact);
  const teamCoordinationSummaries = collectTeamCoordinationSummaries(artifact);
  const identityAuthoritySummaries = collectIdentityAuthoritySummaries(artifact);
  const messagePreviews = messages.slice(0, 3).map((message, index) => ({
    index,
    role: typeof message?.role === "string" ? message.role : "unknown",
    preview: extractMessagePreview(message),
  }));

  return `
    <section class="memory-detail-card" data-subtask-prompt-snapshot-session="${escapeHtml(manifest.conversationId || sessionId || "")}">
      <span class="memory-detail-label">${escapeHtml(t("subtasks.detailPromptSnapshot", {}, "Prompt Snapshot"))}</span>
      <div class="memory-detail-grid">
        ${renderDetailCard(t("subtasks.detailPromptSnapshotConversation", {}, "Snapshot Conversation"), manifest.conversationId || sessionId || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailPromptSnapshotRun", {}, "Snapshot Run"), manifest.runId || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailPromptSnapshotAgent", {}, "Snapshot Agent"), manifest.agentId || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailPromptSnapshotCreatedAt", {}, "Snapshot Created At"), formatDateTime(manifest.createdAt), escapeHtml)}
        ${renderDetailCard(t("subtasks.detailPromptSnapshotMessages", {}, "Messages"), formatNumber(summary.messageCount), escapeHtml)}
        ${renderDetailCard(t("subtasks.detailPromptSnapshotDeltas", {}, "Prompt Deltas"), formatNumber(summary.deltaCount), escapeHtml)}
        ${renderDetailCard(t("subtasks.detailPromptSnapshotBlocks", {}, "Provider Blocks"), formatNumber(summary.providerNativeSystemBlockCount), escapeHtml)}
        ${renderDetailCard(t("subtasks.detailPromptSnapshotTokens", {}, "Estimated Tokens"), formatNumber(summary.tokenBreakdown?.systemPromptEstimatedTokens), escapeHtml)}
      </div>
      ${residentStateBindingLines.length ? `
        <div class="memory-detail-text"><strong>${escapeHtml(t("subtasks.detailPromptSnapshotStateBinding", {}, "State Binding"))}</strong></div>
        ${renderExplainabilityBlock(residentStateBindingLines, escapeHtml)}
      ` : ""}
      ${launchExplainabilityLines.length ? `
        <div class="memory-detail-text"><strong>${escapeHtml(t("subtasks.detailPromptSnapshotExplainability", {}, "Launch Explainability"))}</strong></div>
        ${renderExplainabilityBlock(launchExplainabilityLines, escapeHtml)}
      ` : ""}
      ${renderSummaryListBlock(
        t("subtasks.detailPromptSnapshotActiveSections", {}, "Active Prompt Sections"),
        activeSectionIds,
        escapeHtml,
      )}
      ${renderSummaryListBlock(
        t("subtasks.detailPromptSnapshotActiveDeltas", {}, "Active Prompt Deltas"),
        deltaSummaries,
        escapeHtml,
      )}
      ${renderSummaryListBlock(
        t("subtasks.detailPromptSnapshotProviderBlocks", {}, "Provider Block Routing"),
        providerBlockSummaries,
        escapeHtml,
      )}
      ${renderSummaryListBlock(
        t("subtasks.detailPromptSnapshotTeamCoordination", {}, "Team Coordination"),
        teamCoordinationSummaries,
        escapeHtml,
      )}
      ${renderSummaryListBlock(
        t("subtasks.detailPromptSnapshotFollowUpStrategy", {}, "Follow-Up Strategy"),
        followUpStrategySummaries,
        escapeHtml,
      )}
      ${renderSummaryListBlock(
        t("subtasks.detailPromptSnapshotIdentityAuthority", {}, "Identity Authority"),
        identityAuthoritySummaries,
        escapeHtml,
      )}
      <div class="memory-detail-text"><strong>${escapeHtml(t("subtasks.detailPromptSnapshotSystemPrompt", {}, "System Prompt"))}</strong></div>
      <pre class="memory-detail-pre">${escapeHtml(typeof artifact.systemPrompt === "string" ? artifact.systemPrompt : "-")}</pre>
      ${messagePreviews.length ? `
        <div class="memory-detail-text"><strong>${escapeHtml(t("subtasks.detailPromptSnapshotMessagesPreview", {}, "Message Preview"))}</strong></div>
        <div class="subtask-notification-list">
          ${messagePreviews.map((item) => `
            <div class="subtask-notification-item">
              <div class="subtask-notification-head">
                <span class="memory-badge">${escapeHtml(`#${item.index + 1} ${item.role}`)}</span>
              </div>
              <div class="memory-detail-text">${escapeHtml(item.preview)}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}
