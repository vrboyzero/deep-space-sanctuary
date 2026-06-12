// @vitest-environment jsdom

import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchFeature } from "./experience-workbench.js";

function countStats(items) {
  return (Array.isArray(items) ? items : []).reduce((stats, item) => {
    stats.total += 1;
    if (item?.type === "skill") {
      stats.skills += 1;
    } else {
      stats.methods += 1;
    }
    if (item?.status === "draft") stats.draft += 1;
    if (item?.status === "accepted") stats.accepted += 1;
    if (item?.status === "rejected") stats.rejected += 1;
    return stats;
  }, {
    total: 0,
    methods: 0,
    skills: 0,
    draft: 0,
    accepted: 0,
    rejected: 0,
  });
}

function getRenderedStatValues(container) {
  return Array.from(container.querySelectorAll(".memory-stat-value")).map((node) => node.textContent);
}

function getCapabilityLaneDraftCounts(container) {
  return Array.from(container.querySelectorAll(".memory-usage-overview-lane"))
    .filter((lane) => (lane.querySelector(".memory-usage-overview-title")?.textContent || "").includes("Draft"))
    .map((lane) => lane.querySelector(".memory-stat-caption")?.textContent || "");
}

function findCapabilityLane(container, title) {
  return Array.from(container.querySelectorAll(".memory-usage-overview-lane"))
    .find((lane) => (lane.querySelector(".memory-usage-overview-title")?.textContent || "").includes(title));
}

async function flushAsyncWork(rounds = 1) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createHarness(options = {}) {
  document.body.innerHTML = `
    <section id="experienceWorkbenchSection">
      <div id="experienceWorkbenchTitle"></div>
      <div id="experienceWorkbenchStats"></div>
      <button id="experienceWorkbenchTabCandidates"></button>
      <button id="experienceWorkbenchTabCapabilityAcquisition"></button>
      <button id="experienceWorkbenchTabAssets"></button>
      <button id="experienceWorkbenchTabUsageOverview"></button>
      <div id="experienceWorkbenchCandidatesPane"></div>
      <div id="experienceWorkbenchCapabilityPane" class="hidden"></div>
      <div id="experienceWorkbenchCapabilityOverview"></div>
      <div id="experienceWorkbenchAssetsPane" class="hidden"></div>
      <div id="experienceWorkbenchAssetsList"></div>
      <div id="experienceWorkbenchAssetsDetail"></div>
      <div id="experienceWorkbenchUsagePane" class="hidden"></div>
      <div id="experienceWorkbenchUsageOverview"></div>
      <input id="experienceWorkbenchQuery" />
      <select id="experienceWorkbenchTypeFilter"></select>
      <select id="experienceWorkbenchStatusFilter"></select>
      <button id="experienceWorkbenchResetFilters"></button>
      <button id="experienceWorkbenchCleanupConsumedBtn" class="hidden"></button>
      <input id="experienceGenerateTaskId" />
      <button id="experienceGenerateMethodBtn"></button>
      <button id="experienceGenerateSkillBtn"></button>
      <div id="experienceWorkbenchList"></div>
      <div id="experienceWorkbenchDetail"></div>
    </section>
    <div id="experienceSynthesisModal" class="hidden">
      <div id="experienceSynthesisModalTitle"></div>
      <div id="experienceSynthesisModalSummary"></div>
      <div id="experienceSynthesisModalStatus" class="hidden"></div>
      <label>
        <input id="experienceSynthesisModalConsumeSources" type="checkbox" checked />
        <span id="experienceSynthesisModalConsumeSourcesLabel"></span>
      </label>
      <div id="experienceSynthesisModalList"></div>
      <button id="experienceSynthesisModalClose"></button>
      <button id="experienceSynthesisModalCancel"></button>
      <button id="experienceSynthesisModalSubmit"></button>
    </div>
  `;

  const refs = {
    experienceWorkbenchSection: document.getElementById("experienceWorkbenchSection"),
    experienceWorkbenchTitleEl: document.getElementById("experienceWorkbenchTitle"),
    experienceWorkbenchStatsEl: document.getElementById("experienceWorkbenchStats"),
    experienceWorkbenchTabCandidatesBtn: document.getElementById("experienceWorkbenchTabCandidates"),
    experienceWorkbenchTabCapabilityAcquisitionBtn: document.getElementById("experienceWorkbenchTabCapabilityAcquisition"),
    experienceWorkbenchTabAssetsBtn: document.getElementById("experienceWorkbenchTabAssets"),
    experienceWorkbenchTabUsageOverviewBtn: document.getElementById("experienceWorkbenchTabUsageOverview"),
    experienceWorkbenchCandidatesPaneEl: document.getElementById("experienceWorkbenchCandidatesPane"),
    experienceWorkbenchCapabilityPaneEl: document.getElementById("experienceWorkbenchCapabilityPane"),
    experienceWorkbenchCapabilityOverviewEl: document.getElementById("experienceWorkbenchCapabilityOverview"),
    experienceWorkbenchAssetsPaneEl: document.getElementById("experienceWorkbenchAssetsPane"),
    experienceWorkbenchAssetsListEl: document.getElementById("experienceWorkbenchAssetsList"),
    experienceWorkbenchAssetsDetailEl: document.getElementById("experienceWorkbenchAssetsDetail"),
    experienceWorkbenchUsagePaneEl: document.getElementById("experienceWorkbenchUsagePane"),
    experienceWorkbenchUsageOverviewEl: document.getElementById("experienceWorkbenchUsageOverview"),
    experienceWorkbenchQueryEl: document.getElementById("experienceWorkbenchQuery"),
    experienceWorkbenchTypeFilterEl: document.getElementById("experienceWorkbenchTypeFilter"),
    experienceWorkbenchStatusFilterEl: document.getElementById("experienceWorkbenchStatusFilter"),
    experienceWorkbenchResetFiltersBtn: document.getElementById("experienceWorkbenchResetFilters"),
    experienceWorkbenchCleanupConsumedBtn: document.getElementById("experienceWorkbenchCleanupConsumedBtn"),
    experienceGenerateTaskIdEl: document.getElementById("experienceGenerateTaskId"),
    experienceGenerateMethodBtn: document.getElementById("experienceGenerateMethodBtn"),
    experienceGenerateSkillBtn: document.getElementById("experienceGenerateSkillBtn"),
    experienceWorkbenchListEl: document.getElementById("experienceWorkbenchList"),
    experienceWorkbenchDetailEl: document.getElementById("experienceWorkbenchDetail"),
    experienceSynthesisModalEl: document.getElementById("experienceSynthesisModal"),
    experienceSynthesisModalTitleEl: document.getElementById("experienceSynthesisModalTitle"),
    experienceSynthesisModalSummaryEl: document.getElementById("experienceSynthesisModalSummary"),
    experienceSynthesisModalStatusEl: document.getElementById("experienceSynthesisModalStatus"),
    experienceSynthesisModalConsumeSourcesEl: document.getElementById("experienceSynthesisModalConsumeSources"),
    experienceSynthesisModalConsumeSourcesLabelEl: document.getElementById("experienceSynthesisModalConsumeSourcesLabel"),
    experienceSynthesisModalListEl: document.getElementById("experienceSynthesisModalList"),
    experienceSynthesisModalCloseBtn: document.getElementById("experienceSynthesisModalClose"),
    experienceSynthesisModalCancelBtn: document.getElementById("experienceSynthesisModalCancel"),
    experienceSynthesisModalSubmitBtn: document.getElementById("experienceSynthesisModalSubmit"),
  };

  const experienceState = {
    items: [],
    draftItems: [],
    draftItemsLoading: false,
    draftItemsError: "",
    selectedId: null,
    selectedCandidate: null,
    selectedAssetPath: "",
    selectedAsset: null,
    selectedAssetLoading: false,
    selectedAssetError: "",
    stats: null,
    activeTab: "capability-acquisition",
    filters: {
      query: "",
      type: "",
      status: "",
    },
    generateTaskId: "",
    resynthesizeAssetPath: "",
    requestToken: 0,
    activeAgentId: "default",
    synthesisModal: {
      open: false,
      loading: false,
      submitting: false,
      error: "",
      seedCandidateId: "",
      seedAssetPath: "",
      preview: null,
      markSourcesConsumed: true,
    },
  };
  const memoryViewerState = {
    pendingExperienceActionKey: null,
  };

  const defaultCandidates = [
    {
      id: "draft-method-1",
      taskId: "task-method-1",
      type: "method",
      status: "draft",
      title: "Method Draft One",
      slug: "method-draft-one",
      summary: "method summary",
      content: "# Method Draft One",
      createdAt: "2026-04-20T09:00:00.000Z",
      updatedAt: "2026-04-20T10:00:00.000Z",
      sourceTaskSnapshot: {},
    },
    {
      id: "draft-skill-1",
      taskId: "task-skill-1",
      type: "skill",
      status: "draft",
      title: "Skill Draft One",
      slug: "skill-draft-one",
      summary: "skill summary",
      content: "# Skill Draft One",
      createdAt: "2026-04-20T08:00:00.000Z",
      updatedAt: "2026-04-20T11:00:00.000Z",
      sourceTaskSnapshot: {},
      skillFreshness: {
        status: "needs_patch",
        summary: "需要补丁",
      },
    },
    {
      id: "accepted-method-1",
      taskId: "task-method-2",
      type: "method",
      status: "accepted",
      title: "Accepted Method",
      slug: "accepted-method",
      summary: "accepted summary",
      content: "# Accepted Method",
      createdAt: "2026-04-18T08:00:00.000Z",
      updatedAt: "2026-04-18T09:00:00.000Z",
      sourceTaskSnapshot: {},
      publishedPath: "state/methods/accepted-method.md",
    },
  ];
  const candidates = Array.isArray(options.candidates) && options.candidates.length
    ? options.candidates
    : defaultCandidates;
  const listCandidateIds = Array.isArray(options.listCandidateIds) && options.listCandidateIds.length
    ? [...options.listCandidateIds]
    : null;
  const resolveListItems = () => (
    listCandidateIds
      ? listCandidateIds.map((id) => candidates.find((item) => item.id === id) || null).filter(Boolean)
      : [...candidates]
  );
  const normalizeFilterValues = (value) => Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean)
    : [String(value ?? "").trim().toLowerCase()].filter(Boolean);
  const applyCandidateFilter = (items, filter) => {
    const safeFilter = filter && typeof filter === "object" ? filter : {};
    let filtered = Array.isArray(items) ? [...items] : [];
    const statusValues = normalizeFilterValues(safeFilter.status);
    const typeValues = normalizeFilterValues(safeFilter.type);
    if (statusValues.length) {
      filtered = filtered.filter((item) => statusValues.includes(String(item?.status ?? "").trim().toLowerCase()));
    }
    if (typeValues.length) {
      filtered = filtered.filter((item) => typeValues.includes(String(item?.type ?? "").trim().toLowerCase()));
    }
    if (typeof safeFilter.synthesisConsumed === "boolean") {
      filtered = filtered.filter((item) => {
        const consumed = item?.metadata?.synthesisConsumed?.consumed === true;
        return safeFilter.synthesisConsumed ? consumed : !consumed;
      });
    }
    return filtered;
  };
  const resolveDisplayTaskId = (candidate) => String(candidate?.sourceTaskSnapshot?.taskId || candidate?.taskId || "").trim();
  const buildSynthesisPreviewPayload = (candidateId) => {
    const seedCandidate = candidates.find((item) => item.id === candidateId) || null;
    if (!seedCandidate) {
      return null;
    }
    const relatedItems = candidates
      .filter((item) => (
        item.id !== candidateId
        && item.type === seedCandidate.type
        && item.status === "draft"
      ))
      .map((item, index) => ({
        candidateId: item.id,
        type: item.type,
        status: item.status,
        title: item.title,
        slug: item.slug,
        summary: item.summary,
        taskId: item.taskId,
        sourceTaskId: resolveDisplayTaskId(item),
        updatedAt: item.updatedAt,
        score: 0.82 - (index * 0.05),
        relation: index === 0 ? "same_family" : "similar",
      }));
    const sameFamilyCount = relatedItems.filter((item) => item.relation === "same_family").length;
    const similarCount = relatedItems.filter((item) => item.relation === "similar").length;
    return {
      seedCandidate,
      candidateType: seedCandidate.type,
      totalCount: 1 + relatedItems.length,
      taskCount: new Set([seedCandidate, ...relatedItems].map((item) => String(item?.sourceTaskId || item?.taskId || "").trim()).filter(Boolean)).size,
      items: relatedItems,
      sourceCandidateIds: [seedCandidate.id, ...relatedItems.map((item) => item.candidateId)],
      selectedSourceCount: 1 + relatedItems.length,
      sameFamilyCount,
      similarCount,
      selectedSameFamilyCount: sameFamilyCount,
      selectedSimilarCount: similarCount,
      maxSimilarSourceCount: 5,
      templateInfo: {
        id: `${seedCandidate.type}-synthesis`,
        path: `docs/experience-templates/${seedCandidate.type === "skill" ? "skill-synthesis.md" : "method-synthesis.md"}`,
      },
    };
  };

  const buildSynthesisPreviewPayloadFromAssetPath = (assetPath) => {
    const normalizedAssetPath = String(assetPath ?? "").trim();
    if (!normalizedAssetPath) return null;
    const publishedCandidate = candidates.find((item) => String(item?.publishedPath || "").trim() === normalizedAssetPath) || null;
    if (!publishedCandidate) return null;
    const virtualSeedCandidate = {
      ...publishedCandidate,
      id: `virtual:${publishedCandidate.type}:${String(publishedCandidate.slug || publishedCandidate.id || "asset").toLowerCase()}`,
      status: "published",
      publishedPath: normalizedAssetPath,
      metadata: {
        ...(publishedCandidate.metadata || {}),
        draftOrigin: { kind: "published" },
      },
    };
    const relatedItems = candidates
      .filter((item) => (
        item.type === publishedCandidate.type
        && item.status === "draft"
      ))
      .map((item, index) => ({
        candidateId: item.id,
        type: item.type,
        status: item.status,
        title: item.title,
        slug: item.slug,
        summary: item.summary,
        taskId: item.taskId,
        sourceTaskId: resolveDisplayTaskId(item),
        updatedAt: item.updatedAt,
        score: 0.82 - (index * 0.05),
        relation: index === 0 ? "same_family" : "similar",
      }));
    const sameFamilyCount = relatedItems.filter((item) => item.relation === "same_family").length;
    const similarCount = relatedItems.filter((item) => item.relation === "similar").length;
    return {
      seedCandidate: virtualSeedCandidate,
      candidateType: virtualSeedCandidate.type,
      totalCount: 1 + relatedItems.length,
      taskCount: new Set([virtualSeedCandidate, ...relatedItems].map((item) => String(item?.sourceTaskId || item?.taskId || "").trim()).filter(Boolean)).size,
      items: relatedItems,
      sourceCandidateIds: [virtualSeedCandidate.id, ...relatedItems.map((item) => item.candidateId)],
      selectedSourceCount: 1 + relatedItems.length,
      sameFamilyCount,
      similarCount,
      selectedSameFamilyCount: sameFamilyCount,
      selectedSimilarCount: similarCount,
      maxSimilarSourceCount: 5,
      templateInfo: {
        id: `${virtualSeedCandidate.type}-synthesis`,
        path: `docs/experience-templates/${virtualSeedCandidate.type === "skill" ? "skill-synthesis.md" : "method-synthesis.md"}`,
      },
    };
  };

  const resolvePublishedAssets = () => candidates
    .filter((item) => String(item?.publishedPath || "").trim())
    .map((item) => ({
      source: item.type === "skill" ? "skill_asset" : "method_asset",
      type: item.type,
      key: item.type === "skill"
        ? String(item?.slug || item?.title || item?.id || "").trim() || "skill-asset"
        : path.basename(String(item.publishedPath)),
      title: item.title,
      summary: item.summary,
      publishedPath: String(item.publishedPath),
      metadata: item.type === "skill"
        ? {
          name: String(item?.slug || item?.title || item?.id || "").trim() || undefined,
          description: item.summary,
        }
        : {},
    }));

  const sendReq = vi.fn(async (req) => {
    if (req.method === "experience.candidate.list") {
      const sourceItems = req.params?.filter?.status
        ? candidates
        : resolveListItems();
      const filteredItems = applyCandidateFilter(sourceItems, req.params?.filter);
      const offset = Number.isInteger(req.params?.offset) && req.params.offset > 0 ? req.params.offset : 0;
      const limit = Number.isInteger(req.params?.limit) && req.params.limit > 0 ? req.params.limit : filteredItems.length;
      const items = filteredItems.slice(offset, offset + limit);
      return { ok: true, payload: { items } };
    }
    if (req.method === "experience.candidate.stats") {
      return { ok: true, payload: { stats: countStats(candidates) } };
    }
    if (req.method === "experience.candidate.get") {
      const candidate = candidates.find((item) => item.id === req.params?.candidateId) || null;
      return { ok: true, payload: { candidate } };
    }
    if (req.method === "experience.candidate.accept") {
      const candidate = candidates.find((item) => item.id === req.params?.candidateId) || null;
      if (options.requirePublishConfirmation && req.params?.confirmed !== true) {
        return {
          ok: false,
          error: {
            code: "confirmation_required",
            message: `${candidate?.type || "candidate"} publish requires user confirmation.`,
          },
        };
      }
      if (candidate) {
        candidate.status = "accepted";
        candidate.publishedPath = req.params?.publishTargetPath || (candidate.type === "skill"
          ? `state/skills/${candidate.slug}/SKILL.md`
          : `state/methods/${candidate.slug}.md`);
      }
      return { ok: true, payload: { candidate } };
    }
    if (req.method === "experience.candidate.reject") {
      const candidate = candidates.find((item) => item.id === req.params?.candidateId) || null;
      if (candidate) {
        candidate.status = "rejected";
      }
      return { ok: true, payload: { candidate } };
    }
    if (req.method === "experience.candidate.reject_bulk") {
      const candidateType = String(req.params?.filter?.type ?? "").trim().toLowerCase();
      let count = 0;
      candidates.forEach((candidate) => {
        if (candidate.status === "draft" && String(candidate.type ?? "").trim().toLowerCase() === candidateType) {
          candidate.status = "rejected";
          count += 1;
        }
      });
      return {
        ok: true,
        payload: {
          count,
          filter: {
            type: candidateType,
            status: "draft",
          },
        },
      };
    }
    if (req.method === "experience.asset.list") {
      return {
        ok: true,
        payload: {
          items: resolvePublishedAssets(),
          limit: Number(req.params?.limit) || 200,
        },
      };
    }
    if (req.method === "experience.asset.read") {
      const asset = resolvePublishedAssets().find((item) => item.publishedPath === req.params?.assetPath) || null;
      if (!asset) {
        return { ok: false, error: { code: "not_found", message: "Published asset not found." } };
      }
      const candidate = candidates.find((item) => String(item?.publishedPath || "") === String(asset.publishedPath)) || null;
      return {
        ok: true,
        payload: {
          asset: {
            ...asset,
            content: candidate?.content || "",
          },
        },
      };
    }
    if (req.method === "experience.candidate.cleanup_consumed") {
      const consumedDraftIds = candidates
        .filter((candidate) => (
          candidate.status === "draft"
          && candidate?.metadata?.synthesisConsumed?.consumed === true
        ))
        .map((candidate) => candidate.id);
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        if (consumedDraftIds.includes(candidates[index]?.id)) {
          candidates.splice(index, 1);
        }
      }
      return {
        ok: true,
        payload: {
          count: consumedDraftIds.length,
          filter: {
            status: "draft",
            synthesisConsumed: true,
          },
        },
      };
    }
    if (req.method === "experience.candidate.synthesize.preview") {
      const payload = req.params?.assetPath
        ? buildSynthesisPreviewPayloadFromAssetPath(req.params.assetPath)
        : buildSynthesisPreviewPayload(req.params?.candidateId);
      if (!payload) {
        return { ok: false, error: { code: "not_found", message: "Candidate not found." } };
      }
      return { ok: true, payload };
    }
    if (req.method === "experience.candidate.synthesize.create") {
      const seedCandidate = req.params?.assetPath
        ? (buildSynthesisPreviewPayloadFromAssetPath(req.params.assetPath)?.seedCandidate ?? null)
        : (candidates.find((item) => item.id === req.params?.candidateId) || null);
      if (!seedCandidate) {
        return { ok: false, error: { code: "not_found", message: "Candidate not found." } };
      }
      const sourceCandidateIds = Array.isArray(req.params?.sourceCandidateIds)
        ? req.params.sourceCandidateIds.map((item) => String(item)).filter(Boolean)
        : [seedCandidate.id];
      const markSourcesConsumed = req.params?.markSourcesConsumed !== false;
      const sourceCandidates = sourceCandidateIds
        .map((id) => (id === seedCandidate.id ? seedCandidate : (candidates.find((item) => item.id === id) || null)))
        .filter(Boolean);
      const synthesizedCandidate = {
        id: `${seedCandidate.id}-synthesized`,
        taskId: `${seedCandidate.taskId}::synth::demo`,
        type: seedCandidate.type,
        status: "draft",
        title: `${seedCandidate.title} Synthesized`,
        slug: `${seedCandidate.slug}-synthesized`,
        summary: `Synthesized from ${sourceCandidates.length} drafts`,
        content: seedCandidate.content,
        createdAt: "2026-04-21T09:00:00.000Z",
        updatedAt: "2026-04-21T09:00:00.000Z",
        sourceTaskSnapshot: {
          ...(seedCandidate.sourceTaskSnapshot || {}),
          taskId: resolveDisplayTaskId(seedCandidate),
        },
        metadata: {
          draftOrigin: {
            kind: "synthesized",
          },
          synthesis: {
            seedCandidateId: seedCandidate.id,
            sourceCandidateIds,
            sourceCount: sourceCandidates.length,
            createdBy: "main_model",
            templateId: `${seedCandidate.type}-synthesis`,
            templatePath: `docs/experience-templates/${seedCandidate.type === "skill" ? "skill-synthesis.md" : "method-synthesis.md"}`,
            ...(req.params?.assetPath
              ? {
                seedPublishedPath: req.params.assetPath,
                seedPublishedAssetKey: String(seedCandidate?.slug || seedCandidate?.title || seedCandidate?.id || "").trim(),
                seedPublishedAssetSource: seedCandidate.type === "skill" ? "skill_asset" : "method_asset",
              }
              : {}),
          },
        },
      };
      if (markSourcesConsumed) {
        sourceCandidates.forEach((candidate) => {
          if (!candidate || candidate.id === synthesizedCandidate.id) return;
          if (!candidates.some((item) => item.id === candidate.id)) return;
          candidate.metadata = {
            ...(candidate.metadata || {}),
            synthesisConsumed: {
              consumed: true,
              consumedByCandidateId: synthesizedCandidate.id,
              consumedAt: "2026-04-21T09:01:00.000Z",
              consumedRunId: "synth-demo",
            },
          };
        });
      }
      const consumedSourceCandidateIds = markSourcesConsumed
        ? sourceCandidateIds.filter((id) => candidates.some((item) => item.id === id))
        : [];
      candidates.unshift(synthesizedCandidate);
      return {
        ok: true,
        payload: {
          candidate: synthesizedCandidate,
          created: true,
          sourceCount: sourceCandidates.length,
          sourceCandidateIds,
          consumedSourceCount: consumedSourceCandidateIds.length,
          consumedSourceCandidateIds,
          markSourcesConsumed,
          templateInfo: {
            id: `${seedCandidate.type}-synthesis`,
            path: `docs/experience-templates/${seedCandidate.type === "skill" ? "skill-synthesis.md" : "method-synthesis.md"}`,
          },
        },
      };
    }
    throw new Error(`Unexpected request ${req.method}`);
  });

  const openTaskFromWorkbench = vi.fn(async () => {});
  const showNotice = vi.fn();

  const feature = createExperienceWorkbenchFeature({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: () => "req-1",
    getExperienceWorkbenchState: () => experienceState,
    getMemoryViewerState: () => memoryViewerState,
    getSelectedAgentId: () => "default",
    getSelectedAgentLabel: () => "default",
    renderCandidateDetailPanel: (candidate) => `<div data-rendered-candidate="${candidate?.id || ""}"></div>`,
    renderTaskUsageOverviewCard: () => `<div>usage overview</div>`,
    loadTaskUsageOverview: vi.fn(async () => {}),
    generateExperienceCandidate: vi.fn(async () => null),
    openToolSettingsTab: vi.fn(async () => {}),
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: (value) => String(value ?? ""),
    openTaskFromWorkbench,
    openMemoryFromWorkbench: vi.fn(async () => {}),
    openSourcePath: vi.fn(async () => {}),
    showNotice,
    t: (_key, params, fallback) => {
      let text = fallback ?? "";
      if (params && typeof params === "object") {
        Object.entries(params).forEach(([key, value]) => {
          text = text.replace(`{${key}}`, String(value));
        });
      }
      return text;
    },
  });

  feature.bindUi();

  return {
    refs,
    feature,
    candidates,
    sendReq,
    showNotice,
    openTaskFromWorkbench,
    experienceState,
  };
}

describe("experience workbench capability acquisition", () => {
  it("opens capability acquisition as the default tab", async () => {
    const { refs, feature, experienceState } = createHarness();

    await feature.openExperienceWorkbench();

    expect(experienceState.activeTab).toBe("capability-acquisition");
    expect(refs.experienceWorkbenchCapabilityPaneEl.classList.contains("hidden")).toBe(false);
    expect(refs.experienceWorkbenchCandidatesPaneEl.classList.contains("hidden")).toBe(true);
  });

  it("renders only draft candidates in the capability acquisition tab", async () => {
    const { refs, feature } = createHarness();

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).toContain("Method Draft One");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).toContain("Skill Draft One");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).not.toContain("Published Methods");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).not.toContain("Accepted Method");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.textContent).toContain("ID · draft-method-1");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.textContent).toContain("ID · draft-skill-1");
    expect(refs.experienceWorkbenchCapabilityPaneEl.classList.contains("hidden")).toBe(false);
  });

  it("prioritizes synthesized draft cards before regular drafts in capability acquisition", async () => {
    const candidates = [
      {
        id: "draft-method-regular-new",
        taskId: "task-method-regular-new",
        type: "method",
        status: "draft",
        title: "Method Draft Regular New",
        slug: "method-draft-regular-new",
        summary: "regular new summary",
        content: "# Method Draft Regular New",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T12:00:00.000Z",
        sourceTaskSnapshot: {},
      },
      {
        id: "draft-method-synth-old",
        taskId: "task-method-synth-old",
        type: "method",
        status: "draft",
        title: "Method Draft Synth Old",
        slug: "method-draft-synth-old",
        summary: "synth old summary",
        content: "# Method Draft Synth Old",
        createdAt: "2026-04-20T08:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
        metadata: {
          draftOrigin: {
            kind: "synthesized",
          },
          synthesis: {
            sourceCount: 3,
          },
        },
      },
      {
        id: "draft-method-synth-new",
        taskId: "task-method-synth-new",
        type: "method",
        status: "draft",
        title: "Method Draft Synth New",
        slug: "method-draft-synth-new",
        summary: "synth new summary",
        content: "# Method Draft Synth New",
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T13:00:00.000Z",
        sourceTaskSnapshot: {},
        metadata: {
          draftOrigin: {
            kind: "synthesized",
          },
          synthesis: {
            sourceCount: 5,
          },
        },
      },
      {
        id: "draft-method-regular-old",
        taskId: "task-method-regular-old",
        type: "method",
        status: "draft",
        title: "Method Draft Regular Old",
        slug: "method-draft-regular-old",
        summary: "regular old summary",
        content: "# Method Draft Regular Old",
        createdAt: "2026-04-20T07:00:00.000Z",
        updatedAt: "2026-04-20T09:00:00.000Z",
        sourceTaskSnapshot: {},
      },
    ];
    const { refs, feature } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    const methodLane = findCapabilityLane(refs.experienceWorkbenchCapabilityOverviewEl, "Method Draft");
    const methodTitles = Array.from(
      methodLane?.querySelectorAll(".memory-usage-overview-key") || [],
    ).map((node) => node.textContent.trim());

    expect(methodTitles).toEqual([
      "Method Draft Synth New",
      "Method Draft Synth Old",
      "Method Draft Regular New",
      "Method Draft Regular Old",
    ]);
  });

  it("opens candidate detail and refreshes the capability list after accepting a draft", async () => {
    const { refs, feature, sendReq, openTaskFromWorkbench, experienceState } = createHarness();

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-open-candidate-id='draft-method-1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(experienceState.activeTab).toBe("candidates");
    expect(refs.experienceWorkbenchDetailEl.innerHTML).toContain("data-rendered-candidate=\"draft-method-1\"");

    refs.experienceWorkbenchTabCapabilityAcquisitionBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-open-task-id='task-skill-1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    expect(openTaskFromWorkbench).toHaveBeenCalledWith("task-skill-1");

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-review-candidate-id='draft-method-1'][data-capability-review-candidate-action='accept']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "experience.candidate.accept",
      params: expect.objectContaining({
        candidateId: "draft-method-1",
        agentId: "default",
      }),
    }));
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).not.toContain("Method Draft One");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).toContain("Skill Draft One");
  });

  it("renders top-level memory freshness in candidate detail after candidate.get resolves", async () => {
    const candidates = [
      {
        id: "draft-method-freshness",
        taskId: "task-method-freshness",
        type: "method",
        status: "draft",
        title: "Method Draft Freshness",
        slug: "method-draft-freshness",
        summary: "method summary",
        content: "# Method Draft Freshness",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
        learningReviewInput: {
          summary: { headline: "Learning headline fallback" },
          summaryLines: ["method candidate pending review"],
          nudges: ["Promote after review."],
        },
        memoryFreshness: {
          summary: {
            available: true,
            headline: "Procedural experience needs review before publish.",
            reviewRequiredCount: 1,
            staleCount: 0,
            supersededCount: 0,
          },
        },
      },
    ];
    const { refs, feature } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-open-candidate-id='draft-method-freshness']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(refs.experienceWorkbenchDetailEl.innerHTML).toContain("Memory Freshness：");
    expect(refs.experienceWorkbenchDetailEl.innerHTML).toContain("Procedural experience needs review before publish.");
    expect(refs.experienceWorkbenchDetailEl.innerHTML).toContain("review_required=1 / stale=0 / superseded=0");
  });

  it("retries accept with confirmed flag when publish confirmation is required", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { refs, feature, sendReq } = createHarness({ requirePublishConfirmation: true });

      await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

      refs.experienceWorkbenchCapabilityOverviewEl
        .querySelector("[data-capability-review-candidate-id='draft-method-1'][data-capability-review-candidate-action='accept']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const acceptCalls = sendReq.mock.calls
        .map(([req]) => req)
        .filter((req) => req.method === "experience.candidate.accept");
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(acceptCalls).toHaveLength(2);
      expect(acceptCalls[0].params).toMatchObject({
        candidateId: "draft-method-1",
        agentId: "default",
      });
      expect(acceptCalls[0].params.confirmed).toBeUndefined();
      expect(acceptCalls[1].params).toMatchObject({
        candidateId: "draft-method-1",
        agentId: "default",
        confirmed: true,
      });
      await flushAsyncWork(8);
      expect(findCapabilityLane(refs.experienceWorkbenchCapabilityOverviewEl, "Method Draft")?.innerHTML || "").not.toContain("Method Draft One");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("refreshes the summary stats after rejecting a draft from capability acquisition", async () => {
    const { refs, feature, sendReq } = createHarness({
      listCandidateIds: ["draft-skill-1", "accepted-method-1"],
    });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    expect(getRenderedStatValues(refs.experienceWorkbenchStatsEl)).toEqual(["3", "2", "1", "2", "1", "0"]);
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).toContain("Method Draft One");

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-review-candidate-id='draft-method-1'][data-capability-review-candidate-action='reject']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "experience.candidate.reject",
      params: expect.objectContaining({
        candidateId: "draft-method-1",
        agentId: "default",
      }),
    }));
    expect(getRenderedStatValues(refs.experienceWorkbenchStatsEl)).toEqual(["3", "2", "1", "1", "1", "1"]);
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).not.toContain("Method Draft One");
  });

  it("bulk rejects all method drafts with a single request and updates summary stats", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const candidates = [
        {
          id: "draft-method-1",
          taskId: "task-method-1",
          type: "method",
          status: "draft",
          title: "Method Draft One",
          slug: "method-draft-one",
          summary: "method summary 1",
          content: "# Method Draft One",
          createdAt: "2026-04-20T09:00:00.000Z",
          updatedAt: "2026-04-20T10:00:00.000Z",
          sourceTaskSnapshot: {},
        },
        {
          id: "draft-method-2",
          taskId: "task-method-2",
          type: "method",
          status: "draft",
          title: "Method Draft Two",
          slug: "method-draft-two",
          summary: "method summary 2",
          content: "# Method Draft Two",
          createdAt: "2026-04-20T08:00:00.000Z",
          updatedAt: "2026-04-20T11:00:00.000Z",
          sourceTaskSnapshot: {},
        },
        {
          id: "draft-method-3",
          taskId: "task-method-3",
          type: "method",
          status: "draft",
          title: "Method Draft Three",
          slug: "method-draft-three",
          summary: "method summary 3",
          content: "# Method Draft Three",
          createdAt: "2026-04-20T07:00:00.000Z",
          updatedAt: "2026-04-20T12:00:00.000Z",
          sourceTaskSnapshot: {},
        },
        {
          id: "draft-skill-1",
          taskId: "task-skill-1",
          type: "skill",
          status: "draft",
          title: "Skill Draft One",
          slug: "skill-draft-one",
          summary: "skill summary 1",
          content: "# Skill Draft One",
          createdAt: "2026-04-20T08:30:00.000Z",
          updatedAt: "2026-04-20T12:30:00.000Z",
          sourceTaskSnapshot: {},
        },
        {
          id: "draft-skill-2",
          taskId: "task-skill-2",
          type: "skill",
          status: "draft",
          title: "Skill Draft Two",
          slug: "skill-draft-two",
          summary: "skill summary 2",
          content: "# Skill Draft Two",
          createdAt: "2026-04-20T08:40:00.000Z",
          updatedAt: "2026-04-20T12:40:00.000Z",
          sourceTaskSnapshot: {},
        },
        {
          id: "accepted-method-1",
          taskId: "task-method-accepted-1",
          type: "method",
          status: "accepted",
          title: "Accepted Method",
          slug: "accepted-method",
          summary: "accepted summary",
          content: "# Accepted Method",
          createdAt: "2026-04-18T08:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
          sourceTaskSnapshot: {},
        },
      ];
      const { refs, feature, sendReq } = createHarness({ candidates });

      await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

      expect(getRenderedStatValues(refs.experienceWorkbenchStatsEl)).toEqual(["6", "4", "2", "5", "1", "0"]);
      expect(getCapabilityLaneDraftCounts(refs.experienceWorkbenchCapabilityOverviewEl)).toEqual(["Draft 3", "Draft 2"]);

      refs.experienceWorkbenchCapabilityOverviewEl
        .querySelector("[data-capability-bulk-reject-type='method']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await flushAsyncWork(10);

      const bulkRejectCalls = sendReq.mock.calls
        .map(([req]) => req)
        .filter((req) => req.method === "experience.candidate.reject_bulk");
      const singleRejectCalls = sendReq.mock.calls
        .map(([req]) => req)
        .filter((req) => req.method === "experience.candidate.reject");

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(bulkRejectCalls).toHaveLength(1);
      expect(bulkRejectCalls[0].params).toEqual(expect.objectContaining({
        agentId: "default",
        filter: {
          type: "method",
        },
      }));
      expect(singleRejectCalls).toHaveLength(0);
      expect(getRenderedStatValues(refs.experienceWorkbenchStatsEl)).toEqual(["6", "4", "2", "2", "1", "3"]);
      expect(getCapabilityLaneDraftCounts(refs.experienceWorkbenchCapabilityOverviewEl)).toEqual(["Draft 0", "Draft 2"]);
      expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).not.toContain("Method Draft One");
      expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).toContain("Skill Draft One");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("loads all draft candidates across paged capability requests", async () => {
    const makeDraftCandidate = (type, index) => ({
      id: `${type}-draft-${index}`,
      taskId: `task-${type}-${index}`,
      type,
      status: "draft",
      title: `${type === "skill" ? "Skill" : "Method"} Draft ${index}`,
      slug: `${type}-draft-${index}`,
      summary: `${type} summary ${index}`,
      content: `# ${type} draft ${index}`,
      createdAt: `2026-04-${String(20 - Math.floor(index / 10)).padStart(2, "0")}T${String(index % 10).padStart(2, "0")}:00:00.000Z`,
      updatedAt: `2026-04-${String(20 - Math.floor(index / 10)).padStart(2, "0")}T${String(index % 10).padStart(2, "0")}:30:00.000Z`,
      sourceTaskSnapshot: {},
    });
    const candidates = [
      ...Array.from({ length: 60 }, (_, index) => makeDraftCandidate("method", index)),
      ...Array.from({ length: 60 }, (_, index) => makeDraftCandidate("skill", index)),
    ];
    const { refs, feature, sendReq } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    expect(getCapabilityLaneDraftCounts(refs.experienceWorkbenchCapabilityOverviewEl)).toEqual(["Draft 60", "Draft 60"]);
    const pagedDraftListCalls = sendReq.mock.calls
      .map(([req]) => req)
      .filter((req) => (
        req.method === "experience.candidate.list"
        && req.params?.offset === 100
        && req.params?.filter?.status === "draft"
        && req.params?.filter?.synthesisConsumed === false
      ));
    expect(pagedDraftListCalls).toHaveLength(1);

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-review-candidate-id='method-draft-0'][data-capability-review-candidate-action='reject']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getCapabilityLaneDraftCounts(refs.experienceWorkbenchCapabilityOverviewEl)).toEqual(["Draft 59", "Draft 60"]);
  });

  it("opens the synthesis modal and renders preview rows for similar drafts", async () => {
    const candidates = [
      {
        id: "draft-method-1",
        taskId: "task-method-1",
        type: "method",
        status: "draft",
        title: "Method Draft One",
        slug: "method-draft-one",
        summary: "method summary 1",
        content: "# Method Draft One",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
      },
      {
        id: "draft-method-2",
        taskId: "task-method-2",
        type: "method",
        status: "draft",
        title: "Method Draft Two",
        slug: "method-draft-two",
        summary: "method summary 2",
        content: "# Method Draft Two",
        createdAt: "2026-04-20T08:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z",
        sourceTaskSnapshot: {},
      },
    ];
    const { refs, feature, sendReq, experienceState } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-synthesize-candidate-id='draft-method-1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushAsyncWork(6);

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "experience.candidate.synthesize.preview",
      params: expect.objectContaining({
        candidateId: "draft-method-1",
        agentId: "default",
      }),
    }));
    expect(experienceState.synthesisModal.open).toBe(true);
    expect(refs.experienceSynthesisModalEl.classList.contains("hidden")).toBe(false);
    expect(refs.experienceSynthesisModalTitleEl.textContent).toContain("Method");
    expect(refs.experienceSynthesisModalSummaryEl.textContent).toContain("2");
    expect(refs.experienceSynthesisModalSummaryEl.textContent).toContain("同类命中");
    expect(refs.experienceSynthesisModalSummaryEl.textContent).toContain("近似命中");
    expect(refs.experienceSynthesisModalStatusEl.textContent).toContain("优先选择同类草稿");
    expect(refs.experienceSynthesisModalListEl.querySelectorAll(".experience-synthesis-row")).toHaveLength(2);
    expect(refs.experienceSynthesisModalListEl.textContent).toContain("Method Draft One");
    expect(refs.experienceSynthesisModalListEl.textContent).toContain("Method Draft Two");
  });

  it("starts resynthesize preview from published assetPath in capability acquisition", async () => {
    const candidates = [
      {
        id: "draft-method-1",
        taskId: "task-method-1",
        type: "method",
        status: "draft",
        title: "Method Draft One",
        slug: "method-draft-one",
        summary: "method summary 1",
        content: "# Method Draft One",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
      },
      {
        id: "accepted-method-1",
        taskId: "task-method-2",
        type: "method",
        status: "accepted",
        title: "Accepted Method",
        slug: "accepted-method",
        summary: "accepted summary",
        content: "# Accepted Method",
        createdAt: "2026-04-18T08:00:00.000Z",
        updatedAt: "2026-04-18T09:00:00.000Z",
        sourceTaskSnapshot: {},
        publishedPath: "state/methods/accepted-method.md",
      },
    ];
    const { refs, feature, sendReq, experienceState } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    const assetPathInput = refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-experience-resynthesize-asset-path='1']");
    const previewBtn = refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-experience-resynthesize-preview='1']");
    expect(assetPathInput).toBeTruthy();
    expect(previewBtn).toBeTruthy();

    assetPathInput.value = "state/methods/accepted-method.md";
    assetPathInput.dispatchEvent(new Event("input", { bubbles: true }));
    previewBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork(6);

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "experience.candidate.synthesize.preview",
      params: expect.objectContaining({
        assetPath: "state/methods/accepted-method.md",
        agentId: "default",
      }),
    }));
    expect(experienceState.synthesisModal.open).toBe(true);
    expect(refs.experienceSynthesisModalEl.classList.contains("hidden")).toBe(false);
    expect(refs.experienceSynthesisModalSummaryEl.textContent).toContain("Accepted Method");
  });

  it("switches to the assets tab from capability acquisition and renders published method and skill lanes", async () => {
    const candidates = [
      {
        id: "accepted-method-1",
        taskId: "task-method-2",
        type: "method",
        status: "accepted",
        title: "Accepted Method",
        slug: "accepted-method",
        summary: "accepted summary",
        content: "# Accepted Method",
        createdAt: "2026-04-18T08:00:00.000Z",
        updatedAt: "2026-04-18T09:00:00.000Z",
        sourceTaskSnapshot: {},
        publishedPath: "state/methods/accepted-method.md",
      },
      {
        id: "accepted-skill-1",
        taskId: "task-skill-2",
        type: "skill",
        status: "accepted",
        title: "Accepted Skill",
        slug: "accepted-skill",
        summary: "accepted skill summary",
        content: "# Accepted Skill",
        createdAt: "2026-04-18T08:30:00.000Z",
        updatedAt: "2026-04-18T09:30:00.000Z",
        sourceTaskSnapshot: {},
        publishedPath: "state/skills/accepted-skill/SKILL.md",
      },
      {
        id: "draft-method-1",
        taskId: "task-method-1",
        type: "method",
        status: "draft",
        title: "Method Draft One",
        slug: "method-draft-one",
        summary: "method summary 1",
        content: "# Method Draft One",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
      },
    ];
    const { refs, feature, experienceState } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    expect(refs.experienceWorkbenchCapabilityOverviewEl.textContent).not.toContain("Published Methods");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.textContent).not.toContain("Accepted Method");

    refs.experienceWorkbenchTabAssetsBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushAsyncWork(6);

    expect(experienceState.activeTab).toBe("assets");
    expect(refs.experienceWorkbenchAssetsPaneEl.classList.contains("hidden")).toBe(false);
    expect(refs.experienceWorkbenchAssetsListEl.textContent).toContain("Published Methods");
    expect(refs.experienceWorkbenchAssetsListEl.textContent).toContain("Accepted Method");
    expect(refs.experienceWorkbenchAssetsListEl.querySelector("[data-experience-published-asset-preview='state/methods/accepted-method.md']")).toBeTruthy();
    expect(refs.experienceWorkbenchAssetsDetailEl.textContent).toContain("Published Skills");
    expect(refs.experienceWorkbenchAssetsDetailEl.textContent).toContain("Accepted Skill");
  });

  it("creates a synthesized draft from the modal and keeps the accept shortcut available", async () => {
    const candidates = [
      {
        id: "draft-method-1",
        taskId: "task-method-1",
        type: "method",
        status: "draft",
        title: "Method Draft One",
        slug: "method-draft-one",
        summary: "method summary 1",
        content: "# Method Draft One",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
      },
      {
        id: "draft-method-2",
        taskId: "task-method-2",
        type: "method",
        status: "draft",
        title: "Method Draft Two",
        slug: "method-draft-two",
        summary: "method summary 2",
        content: "# Method Draft Two",
        createdAt: "2026-04-20T08:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z",
        sourceTaskSnapshot: {},
      },
    ];
    const { refs, feature, sendReq, showNotice } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-synthesize-candidate-id='draft-method-1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork(6);

    refs.experienceSynthesisModalSubmitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork(10);

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "experience.candidate.synthesize.create",
      params: expect.objectContaining({
        candidateId: "draft-method-1",
        sourceCandidateIds: ["draft-method-1", "draft-method-2"],
        markSourcesConsumed: true,
      }),
    }));
    expect(refs.experienceSynthesisModalEl.classList.contains("hidden")).toBe(false);
    expect(refs.experienceSynthesisModalSubmitBtn.textContent).toContain("接受并发布新草稿");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).toContain("Method Draft One Synthesized");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.textContent).toContain("ID · draft-method-1-synthesized");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).not.toContain("Method Draft One</div>");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.innerHTML).not.toContain("Method Draft Two</div>");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.querySelector(".experience-synthesized-badge")).toBeTruthy();
    expect(refs.experienceWorkbenchCapabilityOverviewEl.querySelector(".experience-candidate-synthesized")).toBeTruthy();
    expect(showNotice).toHaveBeenCalledWith(
      "合成草稿已创建",
      expect.stringContaining("已标记为已消化"),
      "success",
      2800,
    );
  });

  it("accepts the created synthesized draft directly from the modal shortcut", async () => {
    const candidates = [
      {
        id: "draft-method-1",
        taskId: "task-method-1",
        type: "method",
        status: "draft",
        title: "Method Draft One",
        slug: "method-draft-one",
        summary: "method summary 1",
        content: "# Method Draft One",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
      },
      {
        id: "draft-method-2",
        taskId: "task-method-2",
        type: "method",
        status: "draft",
        title: "Method Draft Two",
        slug: "method-draft-two",
        summary: "method summary 2",
        content: "# Method Draft Two",
        createdAt: "2026-04-20T08:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z",
        sourceTaskSnapshot: {},
      },
    ];
    const { refs, feature, sendReq, experienceState } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "capability-acquisition", preferFirst: false });

    refs.experienceWorkbenchCapabilityOverviewEl
      .querySelector("[data-capability-synthesize-candidate-id='draft-method-1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork(6);

    refs.experienceSynthesisModalSubmitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork(10);

    expect(experienceState.synthesisModal.createdCandidate?.id).toBe("draft-method-1-synthesized");
    expect(refs.experienceSynthesisModalEl.classList.contains("hidden")).toBe(false);
    expect(refs.experienceSynthesisModalSubmitBtn.textContent).toContain("接受并发布新草稿");

    refs.experienceSynthesisModalSubmitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork(10);

    const acceptCalls = sendReq.mock.calls
      .map(([req]) => req)
      .filter((req) => req.method === "experience.candidate.accept");
    expect(acceptCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        params: expect.objectContaining({
          candidateId: "draft-method-1-synthesized",
          agentId: "default",
        }),
      }),
    ]));
    expect(refs.experienceSynthesisModalEl.classList.contains("hidden")).toBe(true);
    expect(candidates.find((item) => item.id === "draft-method-1-synthesized")?.status).toBe("accepted");
    expect(candidates.find((item) => item.id === "draft-method-1-synthesized")?.publishedPath).toBe("state/methods/method-draft-one-synthesized.md");
    expect(findCapabilityLane(refs.experienceWorkbenchCapabilityOverviewEl, "Method Draft")?.innerHTML || "").not.toContain("Method Draft One Synthesized");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.textContent).not.toContain("Published Methods");
    expect(refs.experienceWorkbenchCapabilityOverviewEl.textContent).not.toContain("Method Draft One Synthesized");
  });

  it("opens the assets tab and allows resynthesis from a published asset card", async () => {
    const candidates = [
      {
        id: "accepted-method-1",
        taskId: "task-method-2",
        type: "method",
        status: "accepted",
        title: "Accepted Method",
        slug: "accepted-method",
        summary: "accepted summary",
        content: "# Accepted Method\n\nCurrent published body",
        createdAt: "2026-04-18T08:00:00.000Z",
        updatedAt: "2026-04-18T09:00:00.000Z",
        sourceTaskSnapshot: {},
        publishedPath: "state/methods/accepted-method.md",
      },
      {
        id: "draft-method-1",
        taskId: "task-method-1",
        type: "method",
        status: "draft",
        title: "Method Draft One",
        slug: "method-draft-one",
        summary: "method summary 1",
        content: "# Method Draft One",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
      },
    ];
    const { refs, feature, sendReq, experienceState } = createHarness({ candidates });

    await feature.openExperienceWorkbench({ tab: "assets", preferFirst: true });
    await flushAsyncWork(6);

    expect(experienceState.activeTab).toBe("assets");
    expect(refs.experienceWorkbenchAssetsPaneEl.classList.contains("hidden")).toBe(false);
    expect(refs.experienceWorkbenchAssetsListEl.textContent).toContain("Published Methods");
    expect(refs.experienceWorkbenchAssetsListEl.textContent).toContain("Accepted Method");

    refs.experienceWorkbenchAssetsListEl
      .querySelector("[data-experience-published-asset-preview='state/methods/accepted-method.md']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushAsyncWork(6);

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "experience.candidate.synthesize.preview",
      params: expect.objectContaining({
        assetPath: "state/methods/accepted-method.md",
      }),
    }));
    expect(sendReq).not.toHaveBeenCalledWith(expect.objectContaining({
      method: "experience.asset.read",
    }));
  });

  it("accepts a synthesized asset-based draft by overwriting the original published file", async () => {
    const previousConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    try {
      const candidates = [
        {
          id: "accepted-method-1",
          taskId: "task-method-2",
          type: "method",
          status: "accepted",
          title: "Accepted Method",
          slug: "accepted-method",
          summary: "accepted summary",
          content: "# Accepted Method\n\nCurrent published body",
          createdAt: "2026-04-18T08:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
          sourceTaskSnapshot: {},
          publishedPath: "state/methods/accepted-method.md",
        },
        {
          id: "draft-method-1",
          taskId: "task-method-1",
          type: "method",
          status: "draft",
          title: "Method Draft One",
          slug: "method-draft-one",
          summary: "method summary 1",
          content: "# Method Draft One\n\nSynthesized next body",
          createdAt: "2026-04-20T09:00:00.000Z",
          updatedAt: "2026-04-20T10:00:00.000Z",
          sourceTaskSnapshot: {},
        },
      ];
      const { refs, feature, sendReq, experienceState } = createHarness({ candidates });

      await feature.openExperienceWorkbench({ tab: "assets", preferFirst: true });
      await flushAsyncWork(6);

      refs.experienceWorkbenchAssetsListEl
        .querySelector("[data-experience-published-asset-preview='state/methods/accepted-method.md']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork(6);

      refs.experienceSynthesisModalSubmitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork(10);

      expect(experienceState.synthesisModal.createdCandidate?.id).toBe("virtual:method:accepted-method-synthesized");
      expect(refs.experienceSynthesisModalListEl.textContent).toContain("覆盖前对比");
      expect(refs.experienceSynthesisModalSubmitBtn.textContent).toContain("接受并覆盖原文件");

      refs.experienceSynthesisModalSubmitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork(10);

      const acceptCalls = sendReq.mock.calls
        .map(([req]) => req)
        .filter((req) => req.method === "experience.candidate.accept");
      expect(acceptCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            candidateId: "virtual:method:accepted-method-synthesized",
            publishTargetPath: "state/methods/accepted-method.md",
            confirmed: true,
          }),
        }),
      ]));
      expect(window.confirm).toHaveBeenCalled();
      expect(candidates.find((item) => item.id === "virtual:method:accepted-method-synthesized")?.publishedPath).toBe("state/methods/accepted-method.md");
    } finally {
      window.confirm = previousConfirm;
    }
  });

  it("shows synthesis consumed info in candidate detail", async () => {
    const previousConfig = globalThis.BELLDANDY_WEB_CONFIG;
    const candidates = [
      {
        id: "draft-method-consumed",
        taskId: "task-method-consumed",
        type: "method",
        status: "draft",
        title: "Consumed Draft",
        slug: "consumed-draft",
        summary: "consumed summary",
        content: "# Consumed Draft",
        createdAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        sourceTaskSnapshot: {},
        metadata: {
          synthesisConsumed: {
            consumed: true,
            consumedByCandidateId: "draft-method-1-synthesized",
            consumedAt: "2026-04-21T09:01:00.000Z",
            consumedRunId: "synth-demo",
          },
        },
      },
    ];
    try {
      globalThis.BELLDANDY_WEB_CONFIG = {
        ...(previousConfig && typeof previousConfig === "object" ? previousConfig : {}),
        governanceDetailMode: "full",
      };
      const { refs, feature } = createHarness({ candidates, listCandidateIds: ["draft-method-consumed"] });

      await feature.openExperienceWorkbench({ tab: "candidates", candidateId: "draft-method-consumed", preferFirst: false });

      expect(refs.experienceWorkbenchDetailEl.textContent).toContain("已被合成稿 draft-method-1-synthesized 消化");
      expect(refs.experienceWorkbenchDetailEl.querySelector("[data-open-candidate-id='draft-method-1-synthesized']")).toBeTruthy();
    } finally {
      if (typeof previousConfig === "undefined") {
        delete globalThis.BELLDANDY_WEB_CONFIG;
      } else {
        globalThis.BELLDANDY_WEB_CONFIG = previousConfig;
      }
    }
  });

  it("shows cleanup consumed button in candidates tab and removes consumed drafts after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const candidates = [
        {
          id: "draft-method-consumed",
          taskId: "task-method-consumed",
          type: "method",
          status: "draft",
          title: "Consumed Draft",
          slug: "consumed-draft",
          summary: "consumed summary",
          content: "# Consumed Draft",
          createdAt: "2026-04-20T09:00:00.000Z",
          updatedAt: "2026-04-20T10:00:00.000Z",
          sourceTaskSnapshot: {},
          metadata: {
            synthesisConsumed: {
              consumed: true,
              consumedByCandidateId: "draft-method-1-synthesized",
              consumedAt: "2026-04-21T09:01:00.000Z",
              consumedRunId: "synth-demo",
            },
          },
        },
        {
          id: "draft-method-active",
          taskId: "task-method-active",
          type: "method",
          status: "draft",
          title: "Active Draft",
          slug: "active-draft",
          summary: "active summary",
          content: "# Active Draft",
          createdAt: "2026-04-20T11:00:00.000Z",
          updatedAt: "2026-04-20T12:00:00.000Z",
          sourceTaskSnapshot: {},
        },
      ];
      const { refs, feature, sendReq, showNotice } = createHarness({ candidates });

      await feature.openExperienceWorkbench({ tab: "candidates", preferFirst: false });

      expect(refs.experienceWorkbenchCleanupConsumedBtn.classList.contains("hidden")).toBe(false);

      refs.experienceWorkbenchCleanupConsumedBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork(6);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
        method: "experience.candidate.cleanup_consumed",
        params: expect.objectContaining({
          agentId: "default",
        }),
      }));
      expect(showNotice).toHaveBeenCalledWith(
        "旧稿已清理",
        "已清理 1 个已消化旧草稿。",
        "success",
        2600,
      );
      expect(refs.experienceWorkbenchCleanupConsumedBtn.classList.contains("hidden")).toBe(true);
      expect(refs.experienceWorkbenchListEl.textContent).not.toContain("Consumed Draft");
      expect(refs.experienceWorkbenchListEl.textContent).toContain("Active Draft");
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
