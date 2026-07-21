// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceFeature } from "./workspace.js";

let restoreInnerHtml = null;

afterEach(() => {
  restoreInnerHtml?.();
  restoreInnerHtml = null;
  document.body.replaceChildren();
});

function blockNonEmptyInnerHtml() {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: true,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Workspace tree item must not use innerHTML");
      descriptor.set.call(this, value);
    },
  });
  return () => Object.defineProperty(Element.prototype, "innerHTML", descriptor);
}

function createFeature(fileTreeEl, sendReq) {
  const refs = {
    sidebarEl: document.createElement("aside"),
    sidebarTitleEl: document.createElement("div"),
    fileTreeEl,
    refreshTreeBtn: null,
    editorPathEl: document.createElement("div"),
    editorModeBadgeEl: document.createElement("div"),
    editorTextareaEl: document.createElement("textarea"),
    cancelEditBtn: null,
    saveEditBtn: null,
    openEnvEditorBtn: null,
    switchRootBtn: null,
    switchFacetBtn: null,
    switchCronBtn: null,
    workspaceRootsEl: null,
  };
  return createWorkspaceFeature({
    refs,
    keys: { workspaceRootsKey: "workspace-roots" },
    isConnected: () => true,
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

describe("Workspace tree item DOM owner", () => {
  it("renders directory and file items as text and preserves click RPC wiring", async () => {
    const fileTree = document.createElement("div");
    document.body.append(fileTree);
    const sendReq = vi.fn(async (payload) => {
      if (payload.method === "workspace.list" && payload.params.path === "") {
        return {
          ok: true,
          payload: {
            items: [
              { type: "directory", name: "<script>folder</script>", path: "folder" },
              { type: "file", name: "<svg>file</svg>", path: "file.md" },
            ],
          },
        };
      }
      if (payload.method === "workspace.list" && payload.params.path === "folder") {
        return { ok: true, payload: { items: [] } };
      }
      if (payload.method === "workspace.read") {
        return { ok: true, payload: { content: "file content" } };
      }
      return { ok: false, error: { message: "unexpected request" } };
    });
    const feature = createFeature(fileTree, sendReq);
    restoreInnerHtml = blockNonEmptyInnerHtml();

    await expect(feature.loadFileTree()).resolves.toHaveLength(2);
    const folder = fileTree.querySelector(".tree-folder");
    const file = fileTree.querySelector(".tree-file");
    expect(folder.className).toBe("tree-folder");
    expect(folder.querySelector(".tree-item")?.className).toBe("tree-item");
    expect(folder.querySelector(".tree-item-icon")).not.toBeNull();
    expect(folder.querySelector(".tree-item-name")?.textContent).toBe("<script>folder</script>");
    expect(file.className).toBe("tree-file");
    expect(file.querySelector(".tree-item-icon")).not.toBeNull();
    expect(file.querySelector(".tree-item-name")?.textContent).toBe("<svg>file</svg>");
    expect(fileTree.querySelector("script, svg, img, [onerror]")).toBeNull();

    folder.querySelector(".tree-item").click();
    await vi.waitFor(() => {
      expect(folder.classList.contains("expanded")).toBe(true);
    });
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "workspace.list",
      params: { path: "folder" },
    }));

    file.querySelector(".tree-item").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
        method: "workspace.read",
        params: { path: "file.md" },
      }));
    });
  });
});
