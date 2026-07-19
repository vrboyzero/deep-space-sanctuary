// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBootSequenceFeature } from "./boot-sequence.js";
import { createWebchatLifecycleDiagnostics } from "./webchat-lifecycle-diagnostics.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("WebChat lifecycle aggregate diagnostics", () => {
  it("captures ordered lifecycle triggers using counts without retaining provider content", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="awakening" class="hidden">
        <div id="bootLog"></div>
      </div>
    `;
    const diagnostics = createWebchatLifecycleDiagnostics();
    let pendingRequestCount = 1;
    const feature = createBootSequenceFeature({
      random: () => 0,
      onReplacementSettlement: () => diagnostics.captureReplacementSettlement(),
      onFeatureDispose: () => diagnostics.captureFeatureDispose(),
    });
    diagnostics.registerProvider(() => feature.getRuntimeSnapshot());
    diagnostics.registerProvider(() => ({
      pendingPrivateReadCount: pendingRequestCount,
      retainedPrivateItemCount: pendingRequestCount,
      retainedPrivateBytes: pendingRequestCount * 64,
      conversationId: "conversation-secret",
      content: "private message content",
    }));

    const firstPlay = feature.play();
    const explicit = diagnostics.getSummary();
    expect(explicit).toEqual({
      captureSequence: 1,
      providerCount: 2,
      failedProviderCount: 0,
      activeTimerCount: 1,
      activeListenerCount: 0,
      pendingOperationCount: 1,
      retainedItemCount: 1,
      retainedByteCount: 64,
      replacementSettlementCaptureCount: 0,
      featureDisposeCaptureCount: 0,
      pagehideCaptureCount: 0,
      explicitSnapshotCaptureCount: 1,
    });

    const replacementPlay = feature.play();
    await expect(firstPlay).resolves.toBe(false);
    expect(diagnostics.peekSummary()).toMatchObject({
      captureSequence: 2,
      activeTimerCount: 0,
      pendingOperationCount: 1,
      replacementSettlementCaptureCount: 1,
      explicitSnapshotCaptureCount: 1,
    });

    feature.dispose();
    await expect(replacementPlay).resolves.toBe(false);
    expect(diagnostics.peekSummary()).toMatchObject({
      captureSequence: 3,
      activeTimerCount: 0,
      pendingOperationCount: 1,
      featureDisposeCaptureCount: 1,
    });

    pendingRequestCount = 0;
    const settled = diagnostics.getSummary();
    expect(settled).toMatchObject({
      captureSequence: 4,
      pendingOperationCount: 0,
      retainedItemCount: 0,
      retainedByteCount: 0,
      explicitSnapshotCaptureCount: 2,
    });
    expect(JSON.stringify(settled)).not.toContain("conversation-secret");
    expect(JSON.stringify(settled)).not.toContain("private message content");

    const pagehide = diagnostics.capturePagehide();
    expect(pagehide).toMatchObject({
      captureSequence: 5,
      activeTimerCount: 0,
      activeListenerCount: 0,
      pendingOperationCount: 0,
      retainedItemCount: 0,
      retainedByteCount: 0,
      pagehideCaptureCount: 1,
    });
    expect(diagnostics.capturePagehide()).toEqual(pagehide);
  });

  it("isolates provider failures and ignores unsupported snapshot fields", () => {
    const diagnostics = createWebchatLifecycleDiagnostics();
    diagnostics.registerProvider(() => {
      throw new Error("private provider failure");
    });
    diagnostics.registerProvider(() => ({
      timerTickCount: 99,
      maxEntries: 500,
      disposed: false,
      unknownCount: 200,
      pendingFrameFlush: true,
      renderedToolResultPreviewKeyCount: 4,
    }));

    expect(diagnostics.getSummary()).toMatchObject({
      providerCount: 2,
      failedProviderCount: 1,
      activeTimerCount: 0,
      activeListenerCount: 0,
      pendingOperationCount: 1,
      retainedItemCount: 4,
      retainedByteCount: 0,
    });
  });
});
