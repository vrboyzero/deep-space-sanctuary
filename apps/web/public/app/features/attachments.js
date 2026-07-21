import { setRuntimeStyles, toRuntimeStyleUrl } from "./runtime-style-registry.js";

function parsePositiveIntOrDefault(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function estimateTextBytes(text) {
  if (typeof text !== "string") return 0;
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

function buildClipboardImageFile(file) {
  const ext = file.type.split("/")[1] || "png";
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return new File([file], `paste-${ts}.${ext}`, { type: file.type });
}

function readFileContent(file, asBase64, owner) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const entry = {
      reader,
      settled: false,
      dispose: null,
    };
    const settle = (callback, value) => {
      if (entry.settled) return;
      entry.settled = true;
      reader.onload = null;
      reader.onerror = null;
      owner.activeFileReaders.delete(entry);
      callback(value);
    };
    entry.dispose = () => {
      if (entry.settled) return;
      try {
        reader.abort?.();
      } catch {
        // A browser may finish the read between lifecycle disposal and abort.
      }
      settle(reject, new Error("Attachment read disposed"));
    };
    owner.activeFileReaders.add(entry);
    reader.onload = () => {
      settle(resolve, reader.result);
    };
    reader.onerror = () => settle(reject, reader.error);
    try {
      if (asBase64) {
        reader.readAsDataURL(file);
        return;
      }
      reader.readAsText(file);
    } catch (error) {
      settle(reject, error);
    }
  });
}

function loadImageElementFromFile(file, owner) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const entry = {
      image,
      objectUrl,
      settled: false,
      dispose: null,
    };
    const settle = (callback, value) => {
      if (entry.settled) return;
      entry.settled = true;
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(objectUrl);
      owner.activeImageLoads.delete(entry);
      callback(value);
    };
    entry.dispose = () => {
      if (entry.settled) return;
      try {
        image.src = "";
      } catch {
        // The settlement below still revokes the object URL and releases the owner entry.
      }
      settle(reject, new Error("Attachment image load disposed"));
    };
    owner.activeImageLoads.add(entry);
    image.onload = () => {
      settle(resolve, image);
    };
    image.onerror = (err) => {
      settle(reject, err);
    };
    try {
      image.src = objectUrl;
    } catch (error) {
      settle(reject, error);
    }
  });
}

function canvasToDataUrl(canvas, mimeType, quality) {
  try {
    return canvas.toDataURL(mimeType, quality);
  } catch {
    return "";
  }
}

export function createAttachmentsFeature({
  refs,
  defaultLimits,
  imageCompression,
  estimateDataUrlBytes,
  formatBytes,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    attachmentsPreviewEl,
    attachBtn,
    fileInput,
    composerSection,
    promptEl,
  } = refs;

  const allowedTypes = {
    image: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    video: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
    text: [".txt", ".md", ".json", ".log", ".js", ".ts", ".xml", ".html", ".css", ".csv"],
  };

  let pendingAttachments = [];
  let attachmentLimits = {
    maxFileBytes: defaultLimits.maxFileBytes,
    maxTotalBytes: defaultLimits.maxTotalBytes,
  };
  let disposed = false;
  let lifecycleGeneration = 0;
  const listenerEntries = [];
  const pendingOperations = new Set();
  const activeFileReaders = new Set();
  const activeImageLoads = new Set();
  const dynamicMediaListeners = new Set();
  const asyncResourceOwner = { activeFileReaders, activeImageLoads };
  const attachmentHintEl = ensureAttachmentHintElement();

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  function handleAttachClick() {
    if (disposed) return;
    fileInput?.click();
  }

  function handleFileInputChange() {
    if (disposed) return;
    if (fileInput?.files) void handleFiles(fileInput.files);
    fileInput.value = "";
  }

  function handleComposerDragOver(event) {
    if (disposed) return;
    event.preventDefault();
    composerSection.classList.add("drag-over");
  }

  function handleComposerDragLeave() {
    if (disposed) return;
    composerSection.classList.remove("drag-over");
  }

  function handleComposerDrop(event) {
    if (disposed) return;
    event.preventDefault();
    composerSection.classList.remove("drag-over");
    if (event.dataTransfer?.files) void handleFiles(event.dataTransfer.files);
  }

  function handlePromptPaste(event) {
    if (disposed) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          files.push(buildClipboardImageFile(file));
        }
      }
    }
    if (files.length === 0) return;
    event.preventDefault();
    void handleFiles(files);
  }

  if (attachBtn && fileInput) addOwnedListener(attachBtn, "click", handleAttachClick);
  addOwnedListener(fileInput, "change", handleFileInputChange);
  addOwnedListener(composerSection, "dragover", handleComposerDragOver);
  addOwnedListener(composerSection, "dragleave", handleComposerDragLeave);
  addOwnedListener(composerSection, "drop", handleComposerDrop);
  addOwnedListener(promptEl, "paste", handlePromptPaste);

  function ensureAttachmentHintElement() {
    if (!attachmentsPreviewEl || !attachmentsPreviewEl.parentElement) return null;
    const existing = document.getElementById("attachmentHint");
    if (existing) return existing;

    const hint = document.createElement("div");
    hint.id = "attachmentHint";
    hint.className = "attachment-hint";
    attachmentsPreviewEl.parentElement.insertBefore(hint, attachmentsPreviewEl.nextSibling);
    return hint;
  }

  function estimateAttachmentBytes(attachment) {
    if (!attachment || typeof attachment !== "object") return 0;
    if (typeof attachment.content !== "string") return 0;
    if (attachment.content.startsWith("data:")) return estimateDataUrlBytes(attachment.content);
    return estimateTextBytes(attachment.content);
  }

  function estimatePendingAttachmentTotalBytes() {
    return pendingAttachments.reduce((sum, attachment) => sum + estimateAttachmentBytes(attachment), 0);
  }

  function isOperationCurrent(operation) {
    return !disposed
      && pendingOperations.has(operation)
      && operation.generation === lifecycleGeneration;
  }

  function updateAttachmentHint(extraMessage) {
    if (!attachmentHintEl) return;

    const totalBytes = estimatePendingAttachmentTotalBytes();
    const summary = pendingAttachments.length > 0
      ? t(
        "attachments.summarySelected",
        {
          count: String(pendingAttachments.length),
          totalBytes: formatBytes(totalBytes),
          totalLimit: formatBytes(attachmentLimits.maxTotalBytes),
          fileLimit: formatBytes(attachmentLimits.maxFileBytes),
        },
        `Selected ${pendingAttachments.length} attachment(s), about ${formatBytes(totalBytes)} / ${formatBytes(attachmentLimits.maxTotalBytes)}. Per-file limit ${formatBytes(attachmentLimits.maxFileBytes)}.`,
      )
      : t(
        "attachments.summaryEmpty",
        {
          fileLimit: formatBytes(attachmentLimits.maxFileBytes),
          totalLimit: formatBytes(attachmentLimits.maxTotalBytes),
        },
        `Attachment limits: ${formatBytes(attachmentLimits.maxFileBytes)} per file, ${formatBytes(attachmentLimits.maxTotalBytes)} total.`,
      );

    attachmentHintEl.textContent = extraMessage ? `${extraMessage}\n${summary}` : summary;
    attachmentHintEl.classList.toggle("has-warning", Boolean(extraMessage));
  }

  async function compressImageToDataUrl(file, sourceType) {
    const image = await loadImageElementFromFile(file, asyncResourceOwner);
    if (disposed) throw new Error("Attachment image compression disposed");
    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    let scale = Math.min(1, imageCompression.maxEdge / Math.max(sourceWidth, sourceHeight));

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context unavailable");
    }

    let best = null;
    const preferredType = sourceType === "image/webp" ? "image/webp" : "image/jpeg";
    const fallbackType = preferredType === "image/webp" ? "image/jpeg" : "image/webp";

    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);

      for (const type of [preferredType, fallbackType]) {
        for (const quality of imageCompression.qualities) {
          const dataUrl = canvasToDataUrl(canvas, type, quality);
          if (!dataUrl) continue;
          const bytes = estimateDataUrlBytes(dataUrl);
          if (!best || bytes < best.bytes) {
            best = { dataUrl, bytes, mimeType: type };
          }
          if (bytes <= imageCompression.targetBytes) {
            return { dataUrl, bytes, mimeType: type };
          }
        }
      }

      scale *= imageCompression.resizeFactor;
    }

    return best;
  }

  async function readImageForAttachment(file) {
    const sourceType = (file.type || "image/png").toLowerCase();
    const originalDataUrl = await readFileContent(file, true, asyncResourceOwner);
    if (disposed) throw new Error("Attachment image read disposed");
    const originalBytes = estimateDataUrlBytes(originalDataUrl);

    if (sourceType.includes("gif") || sourceType.includes("svg")) {
      return { content: originalDataUrl, mimeType: sourceType };
    }
    if (originalBytes <= imageCompression.triggerBytes) {
      return { content: originalDataUrl, mimeType: sourceType };
    }

    try {
      const compressed = await compressImageToDataUrl(file, sourceType);
      if (compressed && compressed.dataUrl && compressed.bytes > 0 && compressed.bytes < originalBytes) {
        console.info("Image compressed before upload", {
          name: file.name,
          originalBytes,
          compressedBytes: compressed.bytes,
          mimeType: compressed.mimeType,
        });
        return {
          content: compressed.dataUrl,
          mimeType: compressed.mimeType,
        };
      }
    } catch (err) {
      if (disposed) throw err;
      console.warn("Image compression failed, use original file", { name: file.name, error: String(err) });
    }

    return { content: originalDataUrl, mimeType: sourceType };
  }

  async function handleFiles(files) {
    if (disposed) return;
    const operation = { generation: lifecycleGeneration };
    pendingOperations.add(operation);
    try {
    const rejected = [];
    let projectedTotalBytes = estimatePendingAttachmentTotalBytes();

    for (const file of files) {
      const ext = `.${file.name.split(".").pop().toLowerCase()}`;
      const isImage = allowedTypes.image.includes(ext);
      const isVideo = allowedTypes.video.includes(ext);
      const isText = allowedTypes.text.includes(ext);

      if (!isImage && !isVideo && !isText) {
        console.warn(`不支持的文件类型: ${file.name}`);
        rejected.push(t("attachments.unsupportedType", { name: file.name }, `${file.name}: unsupported file type`));
        continue;
      }

      try {
        let content = "";
        let mimeType = file.type || (isImage ? "image/png" : (isVideo ? "video/mp4" : "text/plain"));
        let attachmentBytes = 0;

        if (!isImage && file.size > attachmentLimits.maxFileBytes) {
          rejected.push(
            t(
              "attachments.singleLimitExceeded",
              {
                name: file.name,
                size: formatBytes(file.size),
                limit: formatBytes(attachmentLimits.maxFileBytes),
              },
              `${file.name}: file size ${formatBytes(file.size)} exceeds the per-file limit ${formatBytes(attachmentLimits.maxFileBytes)}`,
            ),
          );
          continue;
        }
        if (!isImage && projectedTotalBytes + file.size > attachmentLimits.maxTotalBytes) {
          rejected.push(
            t(
              "attachments.totalLimitExceeded",
              {
                name: file.name,
                limit: formatBytes(attachmentLimits.maxTotalBytes),
              },
              `${file.name}: total size would exceed ${formatBytes(attachmentLimits.maxTotalBytes)}`,
            ),
          );
          continue;
        }

        if (isImage) {
          const processed = await readImageForAttachment(file);
          if (!isOperationCurrent(operation)) return;
          content = processed.content;
          mimeType = processed.mimeType;
          attachmentBytes = estimateDataUrlBytes(content);
        } else {
          content = await readFileContent(file, isVideo, asyncResourceOwner);
          if (!isOperationCurrent(operation)) return;
          attachmentBytes = isVideo
            ? estimateDataUrlBytes(content)
            : estimateTextBytes(typeof content === "string" ? content : "");
        }

        if (attachmentBytes > attachmentLimits.maxFileBytes) {
          rejected.push(
            t(
              "attachments.processedLimitExceeded",
              {
                name: file.name,
                size: formatBytes(attachmentBytes),
                limit: formatBytes(attachmentLimits.maxFileBytes),
              },
              `${file.name}: processed size ${formatBytes(attachmentBytes)} exceeds the per-file limit ${formatBytes(attachmentLimits.maxFileBytes)}`,
            ),
          );
          continue;
        }
        if (projectedTotalBytes + attachmentBytes > attachmentLimits.maxTotalBytes) {
          rejected.push(
            t(
              "attachments.totalLimitExceeded",
              {
                name: file.name,
                limit: formatBytes(attachmentLimits.maxTotalBytes),
              },
              `${file.name}: total size would exceed ${formatBytes(attachmentLimits.maxTotalBytes)}`,
            ),
          );
          continue;
        }

        pendingAttachments.push({
          name: file.name,
          type: isImage ? "image" : (isVideo ? "video" : "text"),
          mimeType,
          content,
        });
        projectedTotalBytes += attachmentBytes;
      } catch (err) {
        if (!isOperationCurrent(operation)) return;
        console.error(`读取文件失败: ${file.name}`, err);
        rejected.push(t("attachments.readFailed", { name: file.name }, `${file.name}: failed to read`));
      }
    }

    if (!isOperationCurrent(operation)) return;
    if (rejected.length > 0) {
      const lines = rejected.slice(0, 3).map((item) => `- ${item}`);
      if (rejected.length > 3) {
        lines.push(
          `- ${t("attachments.skippedMore", { count: String(rejected.length - 3) }, `${rejected.length - 3} more file(s) were skipped`)}`,
        );
      }
      renderAttachmentsPreview(`${t("attachments.rejectedPrefix", {}, "The following files were not added:")}\n${lines.join("\n")}`);
      return;
    }

    renderAttachmentsPreview();
    } finally {
      pendingOperations.delete(operation);
    }
  }

  function clearDynamicMediaListeners() {
    for (const entry of dynamicMediaListeners) {
      entry.video.removeEventListener("loadeddata", entry.handleLoadedData);
      entry.video.removeAttribute("src");
    }
    dynamicMediaListeners.clear();
  }

  function renderAttachmentsPreview(hintMessage = "") {
    if (disposed) return;
    clearDynamicMediaListeners();
    if (attachmentsPreviewEl) {
      attachmentsPreviewEl.textContent = "";
      const fragment = document.createDocumentFragment();

      pendingAttachments.forEach((attachment, index) => {
        const item = document.createElement("div");
        item.className = "attachment-item";

        if (attachment.type === "image") {
          const thumbnail = document.createElement("div");
          thumbnail.className = "attachment-thumbnail";
          setRuntimeStyles(thumbnail, {
            "background-image": toRuntimeStyleUrl(attachment.content, thumbnail.ownerDocument),
          });
          thumbnail.title = attachment.name;
          item.appendChild(thumbnail);
        } else if (attachment.type === "video") {
          const thumbnail = document.createElement("div");
          thumbnail.className = "attachment-thumbnail video-thumbnail";
          thumbnail.title = attachment.name;

          const video = document.createElement("video");
          video.src = attachment.content;
          const mediaEntry = { video, handleLoadedData: null };
          const handleLoadedData = () => {
            dynamicMediaListeners.delete(mediaEntry);
            video.removeEventListener("loadeddata", handleLoadedData);
            if (disposed) return;
            const canvas = document.createElement("canvas");
            canvas.width = 80;
            canvas.height = 60;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(video, 0, 0, 80, 60);
            setRuntimeStyles(thumbnail, {
              "background-image": toRuntimeStyleUrl(canvas.toDataURL(), thumbnail.ownerDocument),
            });
          };
          mediaEntry.handleLoadedData = handleLoadedData;
          dynamicMediaListeners.add(mediaEntry);
          video.addEventListener("loadeddata", handleLoadedData, { once: true });

          const playIcon = document.createElement("div");
          playIcon.className = "play-icon-small";
          playIcon.textContent = "▶";
          thumbnail.appendChild(playIcon);
          item.appendChild(thumbnail);
        } else {
          const icon = document.createElement("div");
          icon.className = "file-icon file-icon--large";
          icon.textContent = attachment.type === "audio" ? "🎤" : "📄";
          item.appendChild(icon);
        }

        const nameSpan = document.createElement("span");
        nameSpan.textContent = attachment.name.length > 15 ? `${attachment.name.slice(0, 12)}...` : attachment.name;
        item.appendChild(nameSpan);

        const removeBtn = document.createElement("button");
        removeBtn.className = "remove-btn";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          if (disposed) return;
          pendingAttachments.splice(index, 1);
          renderAttachmentsPreview();
        });
        item.appendChild(removeBtn);

        fragment.appendChild(item);
      });

      attachmentsPreviewEl.appendChild(fragment);
    }

    updateAttachmentHint(hintMessage);
  }

  function syncLimitsFromConfig(config) {
    if (disposed || !config || typeof config !== "object") return;

    attachmentLimits = {
      maxFileBytes: parsePositiveIntOrDefault(
        config["BELLDANDY_ATTACHMENT_MAX_FILE_BYTES"],
        defaultLimits.maxFileBytes,
      ),
      maxTotalBytes: parsePositiveIntOrDefault(
        config["BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES"],
        defaultLimits.maxTotalBytes,
      ),
    };
    updateAttachmentHint();
  }

  function addAttachment(attachment) {
    if (disposed || !attachment || typeof attachment !== "object") return;
    pendingAttachments.push(attachment);
  }

  function clearPendingAttachments() {
    if (disposed) return;
    pendingAttachments = [];
    renderAttachmentsPreview();
  }

  function getPendingAttachments() {
    return pendingAttachments.slice();
  }

  function getAttachmentLimits() {
    return { ...attachmentLimits };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycleGeneration += 1;
    for (const { target, type, handler } of listenerEntries) {
      target.removeEventListener(type, handler);
    }
    listenerEntries.length = 0;
    for (const entry of [...activeFileReaders]) entry.dispose();
    for (const entry of [...activeImageLoads]) entry.dispose();
    clearDynamicMediaListeners();
    pendingAttachments = [];
    composerSection?.classList.remove("drag-over");
    if (fileInput) fileInput.value = "";
    if (attachmentsPreviewEl) attachmentsPreviewEl.textContent = "";
    if (attachmentHintEl) {
      attachmentHintEl.textContent = "";
      attachmentHintEl.classList.remove("has-warning");
    }
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerEntries.length,
      pendingOperationCount: pendingOperations.size,
      activeFileReaderCount: activeFileReaders.size,
      activeImageLoadCount: activeImageLoads.size,
      dynamicMediaListenerCount: dynamicMediaListeners.size,
      attachmentCount: pendingAttachments.length,
      estimatedBytes: estimatePendingAttachmentTotalBytes(),
      generation: lifecycleGeneration,
      disposed,
    };
  }

  return {
    addAttachment,
    clearPendingAttachments,
    dispose,
    estimatePendingAttachmentTotalBytes,
    getAttachmentLimits,
    getPendingAttachments,
    getRuntimeSnapshot,
    renderAttachmentsPreview,
    syncLimitsFromConfig,
  };
}
