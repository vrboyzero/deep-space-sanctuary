// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchFeature } from "./experience-workbench.js";
import { createExperienceWorkbenchListView } from "./experience-workbench-list-view.js";

afterEach(() => {
  document.body.replaceChildren();
});

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Experience Workbench candidate list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createFeature(list, state, sendReq) {
  return createExperienceWorkbenchFeature({
    refs: {
      experienceWorkbenchListEl: list,
      experienceWorkbenchDetailEl: document.createElement("div"),
    },
    isConnected: () => true,
    sendReq,
    makeId: () => "request-1",
    getExperienceWorkbenchState: () => state,
    getMemoryViewerState: () => ({ pendingExperienceActionKey: null }),
    getSelectedAgentId: () => "agent-1",
    getSelectedAgentLabel: () => "Agent 1",
    createCandidateDetailPanel: () => null,
    getTaskUsageOverviewViewModel: () => ({
      title: "Experience Usage Overview",
      caption: "No usage data yet",
      showLanes: false,
      lanes: [],
    }),
    loadTaskUsageOverview: vi.fn(),
    generateExperienceCandidate: vi.fn(),
    openToolSettingsTab: vi.fn(),
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: (value) => `<time>${String(value ?? "")}</time>`,
    openTaskFromWorkbench: vi.fn(),
    openMemoryFromWorkbench: vi.fn(),
    openSourcePath: vi.fn(),
    showNotice: vi.fn(),
    t: (key, _params, fallback) => `<mark data-key="${key}">${fallback}</mark>`,
  });
}

function createState(items) {
  return {
    items,
    draftItems: [],
    publishedAssets: [],
    selectedId: null,
    selectedCandidate: null,
    selectedAssetPath: "",
    selectedAsset: null,
    selectedAssetLoading: false,
    selectedAssetError: "",
    stats: null,
    activeTab: "candidates",
    filters: { query: "", type: "", status: "" },
    requestToken: 0,
    activeAgentId: "agent-1",
    synthesisModal: {
      open: false,
      loading: false,
      submitting: false,
      error: "",
      seedCandidateId: "",
      seedAssetPath: "",
      preview: null,
      markSourcesConsumed: true,
      createdCandidate: null,
    },
  };
}

describe("Experience Workbench candidate list DOM owner", () => {
  it("renders attributes, optional badges, and replacement without an HTML parser", () => {
    const list = document.createElement("div");
    document.body.append(list);
    blockNonEmptyInnerHtml(list);
    const view = createExperienceWorkbenchListView({
      refs: { experienceWorkbenchListEl: list },
    });
    const candidateId = 'candidate"><img src=x onerror=alert(1)>';

    expect(() => view.render({
      items: [
        {
          id: candidateId,
          title: "<script>alert(1)</script>",
          summary: "<svg onload=alert(2)>summary</svg>",
          active: true,
          typeLabel: "<b>method</b>",
          statusLabel: "<i>draft</i>",
          taskLabel: "<mark>Task</mark> task-1",
          synthesisLabel: "<u>synthesized</u>",
          publishedLabel: "<em>Published</em>",
          freshnessLabel: "<strong>needs_patch</strong>",
          updatedAtLabel: "<time>2026-07-21</time>",
        },
      ],
    })).not.toThrow();

    const item = list.firstElementChild;
    expect(item?.className).toBe("memory-list-item active experience-candidate-synthesized");
    expect(item?.getAttribute("data-experience-candidate-id")).toBe(candidateId);
    expect(item?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(1)</script>");
    expect(item?.querySelector(".memory-list-item-snippet")?.textContent).toBe("<svg onload=alert(2)>summary</svg>");
    expect(item?.querySelectorAll(".memory-badge")).toHaveLength(3);
    expect(item?.querySelector(".memory-list-item-meta")?.textContent).toContain("<b>method</b>");
    expect(list.querySelector("script, svg, img, b, i, mark, u, em, strong, time, [onerror], [onload]")).toBeNull();

    const first = list.firstElementChild;
    view.render({
      items: [{
        id: "candidate-second",
        title: "Second",
        summary: "No summary yet.",
        active: false,
        typeLabel: "skill",
        statusLabel: "accepted",
        taskLabel: "",
        synthesisLabel: "",
        publishedLabel: "",
        freshnessLabel: "",
        updatedAtLabel: "2026-07-22",
      }],
    });
    expect(first?.isConnected).toBe(false);
    expect(list.children).toHaveLength(1);
    expect(list.firstElementChild?.getAttribute("data-experience-candidate-id")).toBe("candidate-second");
    expect(() => createExperienceWorkbenchListView({
      refs: { experienceWorkbenchListEl: null },
    }).render({ items: [] })).not.toThrow();
  });

  it("keeps fallback projection and the existing click-to-detail listener after owner rendering", async () => {
    const list = document.createElement("div");
    document.body.append(list);
    blockNonEmptyInnerHtml(list);
    const candidateId = 'candidate"><img src=x onerror=alert(3)>';
    const state = createState([{
      id: candidateId,
      type: "<b>method</b>",
      status: "<i>draft</i>",
      title: "",
      slug: "",
      summary: "",
      taskId: 'task"><svg onload=alert(4)>',
      updatedAt: "2026-07-21T00:00:00Z",
      metadata: {
        draftOrigin: { kind: "synthesized" },
        synthesis: { sourceCount: 2 },
      },
      publishedPath: "state/methods/example.md",
      skillFreshness: { status: "<strong>needs_patch</strong>" },
    }]);
    const sendReq = vi.fn(async (request) => {
      if (request.method === "experience.candidate.get") {
        return { ok: true, payload: { candidate: state.items[0] } };
      }
      return { ok: true, payload: {} };
    });
    const feature = createFeature(list, state, sendReq);

    await feature.syncExperienceWorkbenchUi({ preferFirst: false, loadDetailIfNeeded: false });
    const item = list.querySelector("[data-experience-candidate-id]");
    expect(item?.querySelector(".memory-list-item-title")?.textContent).toBe(candidateId);
    expect(item?.querySelector(".memory-list-item-snippet")?.textContent).toContain("No summary yet");
    expect(item?.classList.contains("experience-candidate-synthesized")).toBe(true);
    expect(item?.querySelectorAll(".memory-badge")).toHaveLength(3);
    expect(list.querySelector("img, svg, script, b, i, mark, strong, time, [onerror], [onload]")).toBeNull();

    item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
        method: "experience.candidate.get",
        params: { candidateId, agentId: "agent-1" },
      }));
    });
  });

  it("renders through the owner before assembling the existing list listener", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/experience-workbench.js"),
      "utf8",
    );
    const listStart = source.indexOf("function renderExperienceWorkbenchList(items)");
    const listEnd = source.indexOf("function bindExperienceWorkbenchDetailActions()", listStart);
    const listSource = source.slice(listStart, listEnd);
    const renderIndex = listSource.indexOf("experienceWorkbenchListView.render({");
    const bindIndex = listSource.indexOf("bindExperienceWorkbenchListActions();", renderIndex);

    expect(source).toContain('import { createExperienceWorkbenchListView }');
    expect(source).toContain("const experienceWorkbenchListView = createExperienceWorkbenchListView({");
    expect(listSource).not.toContain("experienceWorkbenchListEl.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
  });
});
