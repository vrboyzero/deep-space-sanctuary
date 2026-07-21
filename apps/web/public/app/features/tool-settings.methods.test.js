// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createToolSettingsController } from "./tool-settings.js";

function createHarness(payloadOverride = {}) {
  document.body.innerHTML = `
    <div id="toolSettingsModal" class="hidden"></div>
    <button id="openToolSettings"></button>
    <button id="closeToolSettings"></button>
    <button id="saveToolSettings"></button>
    <div id="toolSettingsBody"></div>
    <div id="toolSettingsConfirmModal" class="hidden"></div>
    <div id="toolSettingsConfirmImpact"></div>
    <ul id="toolSettingsConfirmSummary"></ul>
    <div id="toolSettingsConfirmExpiry"></div>
    <button id="toolSettingsConfirmApprove"></button>
    <button id="toolSettingsConfirmReject"></button>
    <button class="tool-tab active" data-tab="builtin"></button>
    <button class="tool-tab" data-tab="mcp"></button>
    <button class="tool-tab" data-tab="plugins"></button>
    <button class="tool-tab" data-tab="methods"></button>
    <button class="tool-tab" data-tab="skills"></button>
  `;

  const refs = {
    toolSettingsConfirmModal: document.getElementById("toolSettingsConfirmModal"),
    toolSettingsConfirmImpactEl: document.getElementById("toolSettingsConfirmImpact"),
    toolSettingsConfirmSummaryEl: document.getElementById("toolSettingsConfirmSummary"),
    toolSettingsConfirmExpiryEl: document.getElementById("toolSettingsConfirmExpiry"),
    toolSettingsConfirmApproveBtn: document.getElementById("toolSettingsConfirmApprove"),
    toolSettingsConfirmRejectBtn: document.getElementById("toolSettingsConfirmReject"),
    toolSettingsModal: document.getElementById("toolSettingsModal"),
    openToolSettingsBtn: document.getElementById("openToolSettings"),
    closeToolSettingsBtn: document.getElementById("closeToolSettings"),
    saveToolSettingsBtn: document.getElementById("saveToolSettings"),
    toolSettingsBody: document.getElementById("toolSettingsBody"),
    toolTabButtons: Array.from(document.querySelectorAll(".tool-tab")),
  };

  const sendReq = vi.fn(async (req) => {
    if (req.method === "tools.list") {
      return {
        ok: true,
        payload: {
          builtin: [],
          mcp: {},
          plugins: [],
          methods: [],
          skills: [],
          runtimeCapabilities: {
            workflow: {
              toolName: "run_workflow",
              runtimeAvailable: false,
              registered: false,
              reasonCode: "runtime_unavailable",
            },
          },
          disabled: { builtin: [], mcp_servers: [], plugins: [], skills: [] },
          visibilityContext: {},
          toolControl: { mode: "disabled", requiresConfirmation: false, hasConfirmPassword: false, pendingRequest: null },
          ...payloadOverride,
        },
      };
    }
    return { ok: true };
  });

  const controller = createToolSettingsController({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: () => "req-1",
    clientId: "client-1",
    getSelectedAgentId: () => "",
    getActiveConversationId: () => "",
    getSelectedSubtaskId: () => "",
    isSubtasksViewActive: () => false,
    showNotice: vi.fn(),
    t: (_key, _params, fallback) => fallback ?? "",
  });

  return { controller, refs, sendReq };
}

describe("tool settings methods tab", () => {
  beforeEach(() => {
    window._belldandyOpenFile = vi.fn();
  });

  it("renders methods and opens file from read-only method index", async () => {
    const { controller, refs } = createHarness({
      methods: [
        {
          filename: "网页自动化基础.md",
          title: "网页自动化基础",
          summary: "用于处理网页自动化的基础 SOP。",
          status: "published",
          path: "methods/网页自动化基础.md",
        },
      ],
    });

    await controller.toggle(true);
    refs.toolTabButtons.find((item) => item.dataset.tab === "methods")?.click();

    expect(refs.toolSettingsBody.textContent).toContain("网页自动化基础");
    expect(refs.toolSettingsBody.textContent).toContain("用于处理网页自动化的基础 SOP。");
    expect(refs.saveToolSettingsBtn.disabled).toBe(true);

    refs.toolSettingsBody.querySelector("[data-method-path]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(window._belldandyOpenFile).toHaveBeenCalledWith("methods/网页自动化基础.md");
  });

  it("renders empty state when no methods are published", async () => {
    const { controller, refs } = createHarness({ methods: [] });

    await controller.toggle(true);
    refs.toolTabButtons.find((item) => item.dataset.tab === "methods")?.click();

    expect(refs.toolSettingsBody.textContent).toContain("未发布方法");
  });

  it("renders loading and empty method states without an HTML parser write", async () => {
    const { controller, refs } = createHarness({ methods: [] });
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(Element.prototype, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Tool Settings empty state must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      await expect(controller.toggle(true)).resolves.toBeUndefined();
      refs.toolTabButtons.find((item) => item.dataset.tab === "methods")?.click();
      expect(refs.toolSettingsBody.children).toHaveLength(1);
      expect(refs.toolSettingsBody.firstElementChild?.className).toBe("tool-settings-empty");
      expect(refs.toolSettingsBody.textContent).toContain("未发布方法");
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", descriptor);
    }
  });

  it("renders Plugins rows and preserves the existing checkbox toggle delegation", async () => {
    const { controller, refs } = createHarness({
      plugins: ["zeta-plugin", "alpha-plugin"],
      disabled: { builtin: [], mcp_servers: [], plugins: ["zeta-plugin"], skills: [] },
      pluginVisibility: {
        "alpha-plugin": { available: true, reasonCode: "available", alwaysEnabled: false },
        "zeta-plugin": {
          available: false,
          reasonCode: "blocked-by-security-matrix",
          reasonMessage: "Blocked by policy",
          alwaysEnabled: false,
        },
      },
    });

    await controller.toggle(true);
    refs.toolTabButtons.find((item) => item.dataset.tab === "plugins")?.click();

    expect([...refs.toolSettingsBody.querySelectorAll(".tool-item-name")].map((node) => node.textContent)).toEqual([
      "alpha-plugin",
      "zeta-plugin",
    ]);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-plugin']")?.checked).toBe(false);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-plugin']")?.closest(".tool-item")?.className).toBe(
      "tool-item disabled unavailable",
    );
    expect(refs.saveToolSettingsBtn.disabled).toBe(false);

    const zetaCheckbox = refs.toolSettingsBody.querySelector("[data-name='zeta-plugin']");
    zetaCheckbox.checked = true;
    zetaCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-plugin']")?.checked).toBe(true);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-plugin']")?.closest(".tool-item")?.className).toBe(
      "tool-item unavailable",
    );
  });

  it("renders MCP rows and preserves the existing checkbox toggle delegation", async () => {
    const { controller, refs } = createHarness({
      mcp: {
        zeta: { tools: ["mcp_zeta_read"] },
        alpha: { tools: [] },
      },
      disabled: { builtin: [], mcp_servers: ["zeta"], plugins: [], skills: [] },
      mcpVisibility: {
        alpha: { available: true, reasonCode: "available", alwaysEnabled: false },
        zeta: {
          available: false,
          reasonCode: "blocked-by-security-matrix",
          reasonMessage: "Blocked by policy",
          alwaysEnabled: false,
        },
      },
    });

    await controller.toggle(true);
    refs.toolTabButtons.find((item) => item.dataset.tab === "mcp")?.click();

    expect([...refs.toolSettingsBody.querySelectorAll(".tool-item-name")].map((node) => node.textContent)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(refs.toolSettingsBody.querySelector(".skill-meta")?.textContent).toBe("No tools");
    expect(refs.toolSettingsBody.querySelector(".skill-desc")?.textContent).toBe("read");
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta']")?.checked).toBe(false);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta']")?.closest(".tool-item")?.className).toBe(
      "tool-item disabled unavailable",
    );
    expect(refs.saveToolSettingsBtn.disabled).toBe(false);

    const zetaCheckbox = refs.toolSettingsBody.querySelector("[data-name='zeta']");
    zetaCheckbox.checked = true;
    zetaCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(refs.toolSettingsBody.querySelector("[data-name='zeta']")?.checked).toBe(true);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta']")?.closest(".tool-item")?.className).toBe(
      "tool-item unavailable",
    );
  });

  it("renders Skills rows and preserves the existing checkbox toggle delegation", async () => {
    const { controller, refs } = createHarness({
      skills: [
        { name: "zeta-skill", source: "user", priority: "low", description: "Zeta description", tags: ["ops"] },
        { name: "alpha-skill", source: "bundled", priority: "high", description: "", tags: [] },
      ],
      disabled: { builtin: [], mcp_servers: [], plugins: [], skills: ["zeta-skill"] },
      skillVisibility: {
        "alpha-skill": { available: true, reasonCode: "available", alwaysEnabled: false },
        "zeta-skill": {
          available: false,
          reasonCode: "blocked-by-security-matrix",
          reasonMessage: "Blocked by policy",
          alwaysEnabled: false,
        },
      },
    });

    await controller.toggle(true);
    refs.toolTabButtons.find((item) => item.dataset.tab === "skills")?.click();

    expect([...refs.toolSettingsBody.querySelectorAll(".tool-item-name")].map((node) => node.textContent)).toEqual([
      "alpha-skill",
      "zeta-skill",
    ]);
    expect(refs.toolSettingsBody.querySelector(".skill-meta")?.textContent).toBe("Bundled · High");
    expect(refs.toolSettingsBody.querySelector(".skill-tags")?.textContent).toBe("ops");
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-skill']")?.checked).toBe(false);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-skill']")?.closest(".tool-item")?.className).toBe(
      "tool-item disabled unavailable",
    );
    expect(refs.saveToolSettingsBtn.disabled).toBe(false);

    const zetaCheckbox = refs.toolSettingsBody.querySelector("[data-name='zeta-skill']");
    zetaCheckbox.checked = true;
    zetaCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-skill']")?.checked).toBe(true);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta-skill']")?.closest(".tool-item")?.className).toBe(
      "tool-item unavailable",
    );
  });

  it("renders Builtin rows and preserves the existing checkbox toggle delegation", async () => {
    const { controller, refs } = createHarness({
      builtin: ["zeta_builtin", "alpha_builtin"],
      disabled: { builtin: ["zeta_builtin"], mcp_servers: [], plugins: [], skills: [] },
      contracts: {
        alpha_builtin: {
          family: "workspace-read",
          riskLevel: "low",
          channels: ["web"],
          safeScopes: ["local-safe"],
          needsPermission: false,
          isReadOnly: true,
          isConcurrencySafe: true,
          activityDescription: "Reads workspace state",
          outputPersistencePolicy: "ephemeral",
        },
      },
      visibility: {
        alpha_builtin: { available: true, reasonCode: "available", alwaysEnabled: false },
        zeta_builtin: {
          available: false,
          reasonCode: "blocked-by-security-matrix",
          reasonMessage: "Blocked by policy",
          alwaysEnabled: false,
        },
      },
    });

    await controller.toggle(true);

    expect([...refs.toolSettingsBody.querySelectorAll(".tool-item-name")].map((node) => node.textContent)).toEqual([
      "alpha_builtin",
      "zeta_builtin",
    ]);
    expect(refs.toolSettingsBody.querySelector(".tool-contract-desc")?.textContent).toBe("Reads workspace state");
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta_builtin']")?.checked).toBe(false);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta_builtin']")?.closest(".tool-item")?.className).toBe(
      "tool-item disabled unavailable",
    );
    expect(refs.saveToolSettingsBtn.disabled).toBe(false);

    const zetaCheckbox = refs.toolSettingsBody.querySelector("[data-name='zeta_builtin']");
    zetaCheckbox.checked = true;
    zetaCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(refs.toolSettingsBody.querySelector("[data-name='zeta_builtin']")?.checked).toBe(true);
    expect(refs.toolSettingsBody.querySelector("[data-name='zeta_builtin']")?.closest(".tool-item")?.className).toBe(
      "tool-item unavailable",
    );
  });

  it("renders workflow capability hint when runtime is unavailable", async () => {
    const { controller, refs } = createHarness({
      builtin: ["alpha_builtin"],
      runtimeCapabilities: {
        workflow: {
          toolName: "run_workflow",
          runtimeAvailable: false,
          registered: false,
          reasonCode: "runtime_unavailable",
        },
      },
    });

    await controller.toggle(true);

    expect(refs.toolSettingsBody.textContent).toContain("Dynamic Workflow");
    expect(refs.toolSettingsBody.textContent).toContain("run_workflow");
    expect(refs.toolSettingsBody.textContent).toContain("not registered in builtin tools");
  });

  it("renders workflow capability ready hint when run_workflow is registered", async () => {
    const { controller, refs } = createHarness({
      builtin: ["alpha_builtin", "run_workflow"],
      runtimeCapabilities: {
        workflow: {
          toolName: "run_workflow",
          runtimeAvailable: true,
          registered: true,
          reasonCode: "available",
        },
      },
    });

    await controller.toggle(true);

    expect(refs.toolSettingsBody.textContent).toContain("Dynamic Workflow");
    expect(refs.toolSettingsBody.textContent).toContain("Workflow tool ready");
    expect(refs.toolSettingsBody.textContent).toContain("available in the current builtin tools list");
  });

  it("notifies the agent conversation after approving a tool settings request", async () => {
    const { controller, refs, sendReq } = createHarness();
    controller.handleConfirmRequired({
      targetClientId: "client-1",
      conversationId: "conv-tool-settings",
      requestId: "REQ01",
      summary: ["关闭 builtin: alpha_builtin"],
      impact: "global change",
      expiresAt: Date.now() + 60_000,
    });

    refs.toolSettingsConfirmApproveBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const confirmCall = sendReq.mock.calls.find(([frame]) => frame.method === "tool_settings.confirm");
    expect(confirmCall?.[0]?.params).toMatchObject({
      requestId: "REQ01",
      conversationId: "conv-tool-settings",
      decision: "approve",
    });
    const notifyCall = sendReq.mock.calls.find(([frame]) => frame.method === "message.send");
    expect(notifyCall?.[0]?.params).toMatchObject({
      conversationId: "conv-tool-settings",
      from: "web",
      roomContext: { environment: "local" },
    });
    expect(notifyCall?.[0]?.params?.text).toContain("decision: approved / 用户已批准");
    expect(notifyCall?.[0]?.params?.text).toContain("关闭 builtin: alpha_builtin");
    expect(notifyCall?.[0]?.params?.text).not.toContain("批准工具设置变更");
  });

  it("notifies the agent conversation after rejecting a tool settings request", async () => {
    const { controller, refs, sendReq } = createHarness();
    controller.handleConfirmRequired({
      targetClientId: "client-1",
      conversationId: "conv-tool-settings",
      requestId: "REQ02",
      summary: ["开启 builtin: beta_builtin"],
      impact: "global change",
      expiresAt: Date.now() + 60_000,
    });

    refs.toolSettingsConfirmRejectBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const confirmCall = sendReq.mock.calls.find(([frame]) => frame.method === "tool_settings.confirm");
    expect(confirmCall?.[0]?.params).toMatchObject({
      requestId: "REQ02",
      conversationId: "conv-tool-settings",
      decision: "reject",
    });
    const notifyCall = sendReq.mock.calls.find(([frame]) => frame.method === "message.send");
    expect(notifyCall?.[0]?.params?.text).toContain("decision: rejected / 用户已拒绝");
    expect(notifyCall?.[0]?.params?.text).toContain("配置未改变");
    expect(notifyCall?.[0]?.params?.text).toContain("开启 builtin: beta_builtin");
  });
});
