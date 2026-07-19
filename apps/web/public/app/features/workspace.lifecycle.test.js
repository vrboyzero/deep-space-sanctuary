// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceFeature } from "./workspace.js";

function createHarness({ sendReq: sendReqOverride } = {}) {
  document.body.innerHTML = `
    <aside id="sidebar"></aside>
    <div id="sidebarTitle"></div>
    <div id="fileTree"></div>
    <div id="editorPath"></div>
    <div id="editorModeBadge" class="hidden"></div>
    <textarea id="editorTextarea"></textarea>
    <button id="cancelEdit"></button>
    <button id="saveEdit"></button>
  `;
  const sendReq = sendReqOverride || vi.fn(async (request) => {
    if (request.method === "workspace.read") {
      return { ok: true, payload: { content: `content:${request.params.path}` } };
    }
    if (request.method === "workspace.write") return { ok: true };
    if (request.method === "workspace.list") return { ok: true, payload: { items: [] } };
    throw new Error(`unexpected request ${request.method}`);
  });
  const switchMode = vi.fn();
  const refs = {
    sidebarEl: document.getElementById("sidebar"),
    sidebarTitleEl: document.getElementById("sidebarTitle"),
    fileTreeEl: document.getElementById("fileTree"),
    editorPathEl: document.getElementById("editorPath"),
    editorModeBadgeEl: document.getElementById("editorModeBadge"),
    editorTextareaEl: document.getElementById("editorTextarea"),
    cancelEditBtn: document.getElementById("cancelEdit"),
    saveEditBtn: document.getElementById("saveEdit"),
  };
  const feature = createWorkspaceFeature({
    refs,
    keys: { workspaceRootsKey: "workspace-roots" },
    isConnected: () => true,
    sendReq,
    makeId: () => "request-1",
    switchMode,
    showNotice: vi.fn(),
    escapeHtml: (value) => String(value),
    loadServerConfig: vi.fn(),
    syncAttachmentLimitsFromConfig: vi.fn(),
    persistWorkspaceRootsField: vi.fn(),
    t: (_key, _params, fallback) => fallback ?? "",
  });
  return { refs, sendReq, switchMode, feature };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("workspace editor save settlement lifecycle", () => {
  it("does not finalize a saved editor after a new file opens", async () => {
    vi.useFakeTimers();
    const { refs, sendReq, switchMode, feature } = createHarness();

    await feature.openFile("first.md");
    await feature.saveFile();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      saveFinalizeTimerActive: true,
      disposed: false,
    });

    await feature.openFile("second.md");
    expect(feature.getRuntimeSnapshot().saveFinalizeTimerActive).toBe(false);
    const listRequestCount = sendReq.mock.calls.filter(([request]) => request.method === "workspace.list").length;
    await vi.advanceTimersByTimeAsync(500);

    expect(refs.editorPathEl.textContent).toBe("second.md");
    expect(refs.editorTextareaEl.value).toBe("content:second.md");
    expect(switchMode).not.toHaveBeenCalledWith("chat");
    expect(sendReq.mock.calls.filter(([request]) => request.method === "workspace.list")).toHaveLength(listRequestCount);
  });

  it("cancels delayed view switch and tree reload on dispose", async () => {
    vi.useFakeTimers();
    const { sendReq, switchMode, feature } = createHarness();

    await feature.openFile("first.md");
    await feature.saveFile();
    const listRequestCount = sendReq.mock.calls.filter(([request]) => request.method === "workspace.list").length;
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      saveFinalizeTimerActive: false,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(switchMode).not.toHaveBeenCalledWith("chat");
    expect(sendReq.mock.calls.filter(([request]) => request.method === "workspace.list")).toHaveLength(listRequestCount);
  });

  it("restores the save button when a newer editor open fails", async () => {
    let resolveWrite;
    const sendReq = vi.fn((request) => {
      if (request.method === "workspace.read" && request.params.path === "first.md") {
        return Promise.resolve({ ok: true, payload: { content: "first" } });
      }
      if (request.method === "workspace.read") {
        return Promise.resolve({ ok: false, error: { message: "read failed" } });
      }
      if (request.method === "workspace.write") {
        return new Promise((resolve) => {
          resolveWrite = resolve;
        });
      }
      if (request.method === "workspace.list") {
        return Promise.resolve({ ok: true, payload: { items: [] } });
      }
      throw new Error(`unexpected request ${request.method}`);
    });
    const { refs, feature } = createHarness({ sendReq });

    await feature.openFile("first.md");
    const savePromise = feature.saveFile();
    expect(refs.saveEditBtn.textContent).toBe("Saving...");
    await feature.openFile("missing.md");
    expect(refs.saveEditBtn.disabled).toBe(false);
    expect(refs.saveEditBtn.textContent).toBe("Save");

    resolveWrite({ ok: true });
    await savePromise;
    expect(feature.getRuntimeSnapshot().saveFinalizeTimerActive).toBe(false);
  });
});
