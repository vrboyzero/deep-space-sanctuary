// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceFeature } from "./workspace.js";

afterEach(() => {
  document.body.replaceChildren();
});

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Workspace tree placeholder must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createFeature({ fileTreeEl, isConnected, sendReq }) {
  return createWorkspaceFeature({
    refs: {
      sidebarEl: document.createElement("aside"),
      sidebarTitleEl: document.createElement("div"),
      fileTreeEl,
      refreshTreeBtn: null,
      editorPathEl: null,
      editorModeBadgeEl: null,
      editorTextareaEl: null,
      cancelEditBtn: null,
      saveEditBtn: null,
      openEnvEditorBtn: null,
      switchRootBtn: null,
      switchFacetBtn: null,
      switchCronBtn: null,
      workspaceRootsEl: null,
    },
    keys: { workspaceRootsKey: "workspace-roots" },
    isConnected,
    sendReq,
    makeId: () => "request-1",
    switchMode: vi.fn(),
    showNotice: vi.fn(),
    escapeHtml: (value) => String(value ?? ""),
    loadServerConfig: vi.fn(),
    syncAttachmentLimitsFromConfig: vi.fn(),
    persistWorkspaceRootsField: vi.fn(),
    t: (key, _params, fallback) => `<img data-key="${key}" onerror=alert(1)>${fallback}`,
  });
}

describe("Workspace tree placeholder DOM owner", () => {
  it("renders root disconnected, failed, and empty states as replaceable text", async () => {
    const fileTree = document.createElement("div");
    document.body.append(fileTree);
    blockNonEmptyInnerHtml(fileTree);
    let connected = false;
    let response = { ok: false, error: { message: "failed" } };
    const feature = createFeature({
      fileTreeEl: fileTree,
      isConnected: () => connected,
      sendReq: vi.fn(async () => response),
    });

    await expect(feature.loadFileTree()).resolves.toEqual([]);
    expect(fileTree.firstElementChild?.className).toBe("tree-loading");
    expect(fileTree.firstElementChild?.textContent).toContain("Disconnected");

    connected = true;
    await expect(feature.loadFileTree()).resolves.toEqual([]);
    expect(fileTree.firstElementChild?.textContent).toContain("Load failed");

    response = { ok: true, payload: { items: [] } };
    await expect(feature.loadFileTree()).resolves.toEqual([]);
    expect(fileTree.firstElementChild?.textContent).toContain("No files");
    feature.refreshLocale();
    expect(fileTree.children).toHaveLength(1);
    expect(fileTree.firstElementChild?.textContent).toContain("No files");
    expect(fileTree.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("replaces folder loading with an empty placeholder and fixed styles", async () => {
    const fileTree = document.createElement("div");
    document.body.append(fileTree);
    const folderRequest = createDeferred();
    const sendReq = vi.fn(async (payload) => {
      if (payload.params.path === "") {
        return { ok: true, payload: { items: [{ type: "directory", name: "folder", path: "folder" }] } };
      }
      return folderRequest.promise;
    });
    const feature = createFeature({
      fileTreeEl: fileTree,
      isConnected: () => true,
      sendReq,
    });

    await feature.loadFileTree();
    const folder = fileTree.querySelector(".tree-folder");
    const children = folder.querySelector(".tree-children");
    blockNonEmptyInnerHtml(children);
    folder.querySelector(".tree-item").click();

    expect(children.firstElementChild?.classList.contains("tree-loading")).toBe(true);
    expect(children.firstElementChild?.textContent).toContain("Loading...");
    expect(children.firstElementChild?.classList.contains("tree-loading--compact")).toBe(true);

    folderRequest.resolve({ ok: true, payload: { items: [] } });
    await vi.waitFor(() => {
      expect(children.firstElementChild?.textContent).toContain("Empty");
    });
    expect(children.firstElementChild?.classList.contains("tree-loading--compact")).toBe(true);
    expect(children.firstElementChild?.classList.contains("tree-loading--muted")).toBe(true);
    expect(children.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("treats a missing root tree panel as a no-op", async () => {
    const feature = createFeature({
      fileTreeEl: null,
      isConnected: () => false,
      sendReq: vi.fn(),
    });

    await expect(feature.loadFileTree()).resolves.toEqual([]);
    expect(() => feature.refreshLocale()).not.toThrow();
  });
});
