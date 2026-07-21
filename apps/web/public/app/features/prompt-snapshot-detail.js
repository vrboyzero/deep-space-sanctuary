import { buildLaunchExplainabilityLines } from "./agent-launch-explainability.js";
import { buildResidentStateBindingLines } from "./resident-state-binding-lines.js";

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}

function text(value) {
  return String(value ?? "");
}

function createElement(ownerDocument, tagName, className = "", value) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = text(value);
  return element;
}

function createDetailCard(ownerDocument, label, value) {
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(
    createElement(ownerDocument, "span", "memory-detail-label", label),
    createElement(ownerDocument, "div", "memory-detail-text", value || "-"),
  );
  return card;
}

function createExplainabilityBlock(ownerDocument, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const block = createElement(ownerDocument, "div", "tool-settings-policy-note");
  block.append(...lines.map((line) => createElement(ownerDocument, "div", "", line)));
  return block;
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

function formatKeyCountSummary(value) {
  const entries = Object.entries(value || {}).filter(([, count]) => Number.isFinite(count) && Number(count) > 0);
  if (!entries.length) return "-";
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

function collectPromptContextInjectionSummaries(summary) {
  const contextInjection = summary?.contextInjection && typeof summary.contextInjection === "object"
    ? summary.contextInjection
    : null;
  if (!contextInjection) {
    return {
      blockTags: [],
      autoRecall: [],
    };
  }
  const blockTags = normalizeStringArray(contextInjection.blockTags);
  const autoRecall = [];
  if (contextInjection.autoRecall && typeof contextInjection.autoRecall === "object") {
    const keptCount = typeof contextInjection.autoRecall.keptCount === "number" && Number.isFinite(contextInjection.autoRecall.keptCount)
      ? Math.max(0, Math.trunc(contextInjection.autoRecall.keptCount))
      : 0;
    const candidateCount = typeof contextInjection.autoRecall.candidateCount === "number" && Number.isFinite(contextInjection.autoRecall.candidateCount)
      ? Math.max(0, Math.trunc(contextInjection.autoRecall.candidateCount))
      : 0;
    const filteredOutCount = typeof contextInjection.autoRecall.filteredOutCount === "number" && Number.isFinite(contextInjection.autoRecall.filteredOutCount)
      ? Math.max(0, Math.trunc(contextInjection.autoRecall.filteredOutCount))
      : 0;
    autoRecall.push(`kept=${keptCount}/${candidateCount}`);
    autoRecall.push(`filtered=${filteredOutCount}`);
    if (typeof contextInjection.autoRecall.minScore === "number" && Number.isFinite(contextInjection.autoRecall.minScore)) {
      autoRecall.push(`minScore=${contextInjection.autoRecall.minScore}`);
    }
    const topHitIds = normalizeStringArray(contextInjection.autoRecall.topHitIds);
    if (topHitIds.length) {
      autoRecall.push(`topHits=${topHitIds.join(", ")}`);
    }
    const sourceMix = formatKeyCountSummary(contextInjection.autoRecall.sourceClassMix);
    if (sourceMix !== "-") {
      autoRecall.push(`sourceMix=${sourceMix}`);
    }
    if (typeof contextInjection.autoRecall.usefulHitCount === "number" && Number.isFinite(contextInjection.autoRecall.usefulHitCount)) {
      autoRecall.push(`useful=${Math.max(0, Math.trunc(contextInjection.autoRecall.usefulHitCount))}`);
    }
    if (typeof contextInjection.autoRecall.usefulHitRate === "number" && Number.isFinite(contextInjection.autoRecall.usefulHitRate)) {
      autoRecall.push(`usefulRate=${contextInjection.autoRecall.usefulHitRate}`);
    }
    if (typeof contextInjection.autoRecall.charsPerUsefulHit === "number" && Number.isFinite(contextInjection.autoRecall.charsPerUsefulHit)) {
      autoRecall.push(`chars/useful=${contextInjection.autoRecall.charsPerUsefulHit}`);
    }
    if (typeof contextInjection.autoRecall.tokensPerUsefulHit === "number" && Number.isFinite(contextInjection.autoRecall.tokensPerUsefulHit)) {
      autoRecall.push(`tok/useful=${contextInjection.autoRecall.tokensPerUsefulHit}`);
    }
    if (typeof contextInjection.autoRecall.nodeSummarySavingsChars === "number" && Number.isFinite(contextInjection.autoRecall.nodeSummarySavingsChars)) {
      autoRecall.push(`summarySaveChars=${Math.max(0, Math.trunc(contextInjection.autoRecall.nodeSummarySavingsChars))}`);
    }
    if (typeof contextInjection.autoRecall.nodeSummarySavingsTokens === "number" && Number.isFinite(contextInjection.autoRecall.nodeSummarySavingsTokens)) {
      autoRecall.push(`summarySaveTok=${Math.max(0, Math.trunc(contextInjection.autoRecall.nodeSummarySavingsTokens))}`);
    }
    if (typeof contextInjection.autoRecall.nodeSummaryCompressionRatio === "number" && Number.isFinite(contextInjection.autoRecall.nodeSummaryCompressionRatio)) {
      autoRecall.push(`summaryCompression=${contextInjection.autoRecall.nodeSummaryCompressionRatio}`);
    }
  }
  return {
    blockTags,
    autoRecall,
  };
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

    const detailParts = [];
    const summary = normalizeInlineString(followUpStrategy.summary);
    const recommendedRuntimeAction = normalizeInlineString(followUpStrategy.recommendedRuntimeAction);
    const highPriorityLabels = normalizeStringArray(followUpStrategy.highPriorityLabels);
    const verifierHandoffLabels = normalizeStringArray(followUpStrategy.verifierHandoffLabels);
    if (recommendedRuntimeAction) detailParts.push(`runtime=${recommendedRuntimeAction}`);
    if (highPriorityLabels.length) detailParts.push(`high=${highPriorityLabels.join(" | ")}`);
    if (verifierHandoffLabels.length) detailParts.push(`verifier_handoff=${verifierHandoffLabels.join(" | ")}`);
    if (summary && !detailParts.length) {
      pushSummary(`${deltaType}: ${summary}`);
    }
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

function createSummaryListBlock(ownerDocument, title, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const titleLine = createElement(ownerDocument, "div", "memory-detail-text");
  titleLine.append(createElement(ownerDocument, "strong", "", title));
  const list = createElement(ownerDocument, "div", "tool-settings-policy-note");
  list.append(...items.map((item) => createElement(ownerDocument, "div", "", item)));
  return [titleLine, list];
}

export function createPromptSnapshotDetailView({
  ownerDocument,
  formatDateTime,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  return {
    render(view, sessionId = "") {
  const snapshot = view?.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    if (!sessionId) return null;
    const missing = createElement(ownerDocument, "section", "memory-detail-card");
    missing.setAttribute("data-subtask-prompt-snapshot-session", text(sessionId));
    missing.append(
      createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailPromptSnapshot", {}, "Prompt Snapshot")),
      createElement(ownerDocument, "div", "memory-detail-text", t("subtasks.detailPromptSnapshotMissing", {}, "This subtask session has no persisted prompt snapshot yet.")),
    );
    return missing;
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
  const contextInjectionSummaries = collectPromptContextInjectionSummaries(summary);
  const messagePreviews = messages.slice(0, 3).map((message, index) => ({
    index,
    role: typeof message?.role === "string" ? message.role : "unknown",
    preview: extractMessagePreview(message),
  }));
  const section = createElement(ownerDocument, "section", "memory-detail-card");
  section.setAttribute("data-subtask-prompt-snapshot-session", text(manifest.conversationId || sessionId || ""));
  section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailPromptSnapshot", {}, "Prompt Snapshot")));

  const grid = createElement(ownerDocument, "div", "memory-detail-grid");
  grid.append(
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotConversation", {}, "Snapshot Conversation"), manifest.conversationId || sessionId || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotRun", {}, "Snapshot Run"), manifest.runId || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotAgent", {}, "Snapshot Agent"), manifest.agentId || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotCreatedAt", {}, "Snapshot Created At"), formatDateTime(manifest.createdAt)),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotMessages", {}, "Messages"), formatNumber(summary.messageCount)),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotDeltas", {}, "Prompt Deltas"), formatNumber(summary.deltaCount)),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotBlocks", {}, "Provider Blocks"), formatNumber(summary.providerNativeSystemBlockCount)),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotTokens", {}, "Estimated Tokens"), formatNumber(summary.tokenBreakdown?.systemPromptEstimatedTokens)),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotPrependChars", {}, "Prepend Context Chars"), formatNumber(summary.contextInjection?.prependContextChars)),
    createDetailCard(ownerDocument, t("subtasks.detailPromptSnapshotInjectionBlocks", {}, "Context Injection Blocks"), formatNumber(summary.contextInjection?.totalBlockCount)),
    createDetailCard(
      ownerDocument,
      t("subtasks.detailPromptSnapshotAutoRecall", {}, "Auto Recall"),
      `${formatNumber(summary.contextInjection?.autoRecall?.keptCount)}/${formatNumber(summary.contextInjection?.autoRecall?.candidateCount)}`,
    ),
  );
  section.append(grid);

  const appendTitledExplainability = (title, lines) => {
    const block = createExplainabilityBlock(ownerDocument, lines);
    if (!block) return;
    const titleLine = createElement(ownerDocument, "div", "memory-detail-text");
    titleLine.append(createElement(ownerDocument, "strong", "", title));
    section.append(titleLine, block);
  };
  appendTitledExplainability(t("subtasks.detailPromptSnapshotStateBinding", {}, "State Binding"), residentStateBindingLines);
  appendTitledExplainability(t("subtasks.detailPromptSnapshotExplainability", {}, "Launch Explainability"), launchExplainabilityLines);

  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotContextInjectionTags", {}, "Context Injection Block Tags"), contextInjectionSummaries.blockTags));
  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotAutoRecallSummary", {}, "Auto Recall Summary"), contextInjectionSummaries.autoRecall));
  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotActiveSections", {}, "Active Prompt Sections"), activeSectionIds));
  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotActiveDeltas", {}, "Active Prompt Deltas"), deltaSummaries));
  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotProviderBlocks", {}, "Provider Block Routing"), providerBlockSummaries));
  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotTeamCoordination", {}, "Team Coordination"), teamCoordinationSummaries));
  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotFollowUpStrategy", {}, "Follow-Up Strategy"), followUpStrategySummaries));
  section.append(...createSummaryListBlock(ownerDocument, t("subtasks.detailPromptSnapshotIdentityAuthority", {}, "Identity Authority"), identityAuthoritySummaries));

  const systemPromptTitle = createElement(ownerDocument, "div", "memory-detail-text");
  systemPromptTitle.append(createElement(ownerDocument, "strong", "", t("subtasks.detailPromptSnapshotSystemPrompt", {}, "System Prompt")));
  section.append(
    systemPromptTitle,
    createElement(ownerDocument, "pre", "memory-detail-pre", typeof artifact.systemPrompt === "string" ? artifact.systemPrompt : "-"),
  );

  if (messagePreviews.length) {
    const messageTitle = createElement(ownerDocument, "div", "memory-detail-text");
    messageTitle.append(createElement(ownerDocument, "strong", "", t("subtasks.detailPromptSnapshotMessagesPreview", {}, "Message Preview")));
    const messagesList = createElement(ownerDocument, "div", "subtask-notification-list");
    messagesList.append(...messagePreviews.map((message) => {
      const notification = createElement(ownerDocument, "div", "subtask-notification-item");
      const head = createElement(ownerDocument, "div", "subtask-notification-head");
      head.append(createElement(ownerDocument, "span", "memory-badge", `#${message.index + 1} ${message.role}`));
      notification.append(head, createElement(ownerDocument, "div", "memory-detail-text", message.preview));
      return notification;
    }));
    section.append(messageTitle, messagesList);
  }

  return section;
    },
  };
}
