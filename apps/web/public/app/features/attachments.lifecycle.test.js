// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAttachmentsFeature } from "./attachments.js";

const originalFileReader = globalThis.FileReader;

class DeferredFileReader {
  static instances = [];

  constructor() {
    this.abort = vi.fn(() => {
      this.readyState = 2;
    });
    this.error = null;
    this.onload = null;
    this.onerror = null;
    this.readyState = 0;
    this.result = null;
    DeferredFileReader.instances.push(this);
  }

  readAsText() {
    this.readyState = 1;
  }

  readAsDataURL() {
    this.readyState = 1;
  }

  resolve(result) {
    this.readyState = 2;
    this.result = result;
    this.onload?.();
  }
}

function installDeferredFileReader() {
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: DeferredFileReader,
    writable: true,
  });
}

function createHarness() {
  document.body.innerHTML = `
    <section id="composer">
      <textarea id="prompt"></textarea>
      <button id="attach" type="button">Attach</button>
      <input id="file" type="file" />
      <div id="preview"></div>
    </section>
  `;
  const refs = {
    attachmentsPreviewEl: document.getElementById("preview"),
    attachBtn: document.getElementById("attach"),
    fileInput: document.getElementById("file"),
    composerSection: document.getElementById("composer"),
    promptEl: document.getElementById("prompt"),
  };
  const feature = createAttachmentsFeature({
    refs,
    defaultLimits: { maxFileBytes: 1024, maxTotalBytes: 2048 },
    imageCompression: {
      triggerBytes: 512,
      targetBytes: 256,
      maxEdge: 1024,
      resizeFactor: 0.8,
      qualities: [0.8],
    },
    estimateDataUrlBytes: (value) => String(value || "").length,
    formatBytes: (value) => `${value} B`,
  });
  return { feature, refs };
}

function selectFile(input, file) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event("change"));
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  DeferredFileReader.instances = [];
  document.body.replaceChildren();
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: originalFileReader,
    writable: true,
  });
});

describe("attachments feature lifecycle", () => {
  it("keeps normal text attachment settlement", async () => {
    installDeferredFileReader();
    const { feature, refs } = createHarness();
    selectFile(refs.fileInput, new File(["hello"], "note.txt", { type: "text/plain" }));
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 6,
      pendingOperationCount: 1,
      activeFileReaderCount: 1,
      attachmentCount: 0,
      disposed: false,
    });

    DeferredFileReader.instances[0].resolve("hello");
    await flushPromises();
    expect(feature.getPendingAttachments()).toEqual([{
      name: "note.txt",
      type: "text",
      mimeType: "text/plain",
      content: "hello",
    }]);
    expect(refs.attachmentsPreviewEl.textContent).toContain("note.txt");
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingOperationCount: 0,
      activeFileReaderCount: 0,
      attachmentCount: 1,
      estimatedBytes: 5,
    });
  });

  it("aborts pending reads and clears retained attachment content on dispose", async () => {
    installDeferredFileReader();
    const { feature, refs } = createHarness();
    feature.addAttachment({
      name: "retained.webm",
      type: "video",
      mimeType: "video/webm",
      content: "data:video/webm;base64,cmV0YWluZWQ=",
    });
    feature.renderAttachmentsPreview();
    selectFile(refs.fileInput, new File(["late"], "late.txt", { type: "text/plain" }));
    const reader = DeferredFileReader.instances[0];
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 6,
      pendingOperationCount: 1,
      activeFileReaderCount: 1,
      attachmentCount: 1,
    });

    refs.composerSection.classList.add("drag-over");
    feature.dispose();
    feature.dispose();
    await flushPromises();
    expect(reader.abort).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingOperationCount: 0,
      activeFileReaderCount: 0,
      activeImageLoadCount: 0,
      dynamicMediaListenerCount: 0,
      attachmentCount: 0,
      estimatedBytes: 0,
      generation: 1,
      disposed: true,
    });
    expect(refs.composerSection.classList.contains("drag-over")).toBe(false);
    expect(refs.attachmentsPreviewEl.textContent).toBe("");

    refs.attachBtn.click();
    refs.fileInput.dispatchEvent(new Event("change"));
    DeferredFileReader.instances[0]?.resolve("late");
    await flushPromises();
    expect(feature.getPendingAttachments()).toEqual([]);
    expect(DeferredFileReader.instances).toHaveLength(1);
  });
});
