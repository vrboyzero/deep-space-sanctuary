import type { SessionRestoreView } from "./session-restore.js";
import type {
  SessionTranscriptCompactBoundaryEvent,
  SessionTranscriptEvent,
  SessionTranscriptMessageEvent,
  SessionTranscriptPageReadResult,
  SessionTranscriptPartialCompactionViewEvent,
} from "./session-transcript.js";

export const SESSION_TIMELINE_SCHEMA_VERSION = 1;

export type SessionTimelineWarningCode =
  | "transcript_empty"
  | "transcript_truncated"
  | "transcript_corrupt"
  | "transcript_cursor_invalidated"
  | "conversation_fallback_used"
  | "no_compact_boundary"
  | "restore_fallback_to_raw";

export type SessionTimelineMessageItem = {
  kind: "message";
  eventId: string;
  eventType: SessionTranscriptMessageEvent["type"];
  createdAt: number;
  messageId: string;
  role: "user" | "assistant";
  contentPreview: string;
  contentLength: number;
  truncated: boolean;
  agentId?: string;
};

export type SessionTimelineCompactBoundaryItem = {
  kind: "compact_boundary";
  eventId: string;
  eventType: "compact_boundary_recorded";
  createdAt: number;
  boundaryId: string;
  trigger: SessionTranscriptCompactBoundaryEvent["payload"]["boundary"]["trigger"];
  tier?: SessionTranscriptCompactBoundaryEvent["payload"]["boundary"]["tier"];
  compactedMessageCount: number;
  preCompactTokenCount: number;
  postCompactTokenCount: number;
  tokenDelta: number;
  fallbackUsed: boolean;
  rebuildTriggered: boolean;
  preservedSegment: SessionTranscriptCompactBoundaryEvent["payload"]["boundary"]["preservedSegment"];
  summaryRefKind?: "compaction_state" | "partial_compaction_view";
  partialCompactionViewId?: string;
};

export type SessionTimelinePartialCompactionItem = {
  kind: "partial_compaction";
  eventId: string;
  eventType: "partial_compaction_view_recorded";
  createdAt: number;
  boundaryId?: string;
  partialViewId: string;
  direction: SessionTranscriptPartialCompactionViewEvent["payload"]["view"]["direction"];
  pivotMessageId: string;
  pivotMessageCount: number;
  compactedMessageCount: number;
  summaryMessageCount: number;
  originalTokens: number;
  compactedTokens: number;
  tokenDelta: number;
  fallbackUsed: boolean;
  tier?: SessionTranscriptPartialCompactionViewEvent["payload"]["view"]["tier"];
};

export type SessionTimelineRestoreResultItem = {
  kind: "restore_result";
  createdAt: number;
  source: SessionRestoreView["diagnostics"]["source"];
  transcriptEventCount: number;
  transcriptMessageEventCount: number;
  relinkApplied: boolean;
  fallbackToRaw: boolean;
  fallbackReason?: SessionRestoreView["diagnostics"]["fallbackReason"];
  boundaryId?: string;
  partialViewId?: string;
  rawMessageCount: number;
  compactedViewCount: number;
  canonicalExtractionCount: number;
};

export type SessionTimelineItem =
  | SessionTimelineMessageItem
  | SessionTimelineCompactBoundaryItem
  | SessionTimelinePartialCompactionItem
  | SessionTimelineRestoreResultItem;

export type SessionTimelineProjection = {
  manifest: {
    schemaVersion: number;
    conversationId: string;
    projectedAt: number;
    source: "conversation.timeline.get";
  };
  items: SessionTimelineItem[];
  summary: {
    eventCount: number;
    itemCount: number;
    messageCount: number;
    compactBoundaryCount: number;
    partialCompactionCount: number;
    latestEventAt?: number;
    restore: {
      source: SessionRestoreView["diagnostics"]["source"];
      relinkApplied: boolean;
      fallbackToRaw: boolean;
      fallbackReason?: SessionRestoreView["diagnostics"]["fallbackReason"];
    };
    boundaryId?: string;
    partialViewId?: string;
  };
  warnings: SessionTimelineWarningCode[];
};

export type SessionTimelinePageItem = Exclude<SessionTimelineItem, SessionTimelineRestoreResultItem>;

export type SessionTimelinePage = {
  manifest: {
    schemaVersion: number;
    conversationId: string;
    projectedAt: number;
    source: "conversation.timeline.page";
    revision?: string;
  };
  items: SessionTimelinePageItem[];
  summary: {
    eventCount: number;
    itemCount: number;
    messageCount: number;
    compactBoundaryCount: number;
    partialCompactionCount: number;
    latestEventAt?: number;
  };
  page: {
    pageSize: number;
    cursorStatus: SessionTranscriptPageReadResult["cursorStatus"];
    cursorInvalidationReason?: SessionTranscriptPageReadResult["cursorInvalidationReason"];
    nextCursor?: string;
  };
  warnings: SessionTimelineWarningCode[];
};

type BuildSessionTimelineProjectionInput = {
  conversationId: string;
  transcriptEvents: SessionTranscriptEvent[];
  restore: SessionRestoreView;
  projectedAt?: number;
  previewChars?: number;
};

type BuildSessionTimelinePageInput = {
  conversationId: string;
  transcriptPage: SessionTranscriptPageReadResult;
  pageSize: number;
  projectedAt?: number;
  previewChars?: number;
};

function isMessageEvent(event: SessionTranscriptEvent): event is SessionTranscriptMessageEvent {
  return event.type === "user_message_accepted" || event.type === "assistant_message_finalized";
}

function isCompactBoundaryEvent(event: SessionTranscriptEvent): event is SessionTranscriptCompactBoundaryEvent {
  return event.type === "compact_boundary_recorded";
}

function isPartialCompactionEvent(event: SessionTranscriptEvent): event is SessionTranscriptPartialCompactionViewEvent {
  return event.type === "partial_compaction_view_recorded";
}

function buildPreview(content: string, limit: number): {
  preview: string;
  length: number;
  truncated: boolean;
} {
  const normalized = content.trim();
  if (normalized.length <= limit) {
    return {
      preview: normalized,
      length: content.length,
      truncated: false,
    };
  }
  return {
    preview: `${normalized.slice(0, limit)}...`,
    length: content.length,
    truncated: true,
  };
}

function buildWarnings(
  transcriptEvents: SessionTranscriptEvent[],
  restore: SessionRestoreView,
): SessionTimelineWarningCode[] {
  const warnings: SessionTimelineWarningCode[] = [];
  if (transcriptEvents.length === 0) {
    warnings.push("transcript_empty");
  }
  if (restore.diagnostics.transcriptRead?.truncated) {
    warnings.push("transcript_truncated");
  }
  if (restore.diagnostics.transcriptRead?.corrupt) {
    warnings.push("transcript_corrupt");
  }
  if (restore.diagnostics.source === "conversation_fallback") {
    warnings.push("conversation_fallback_used");
  }
  if (restore.diagnostics.fallbackReason === "no_boundary") {
    warnings.push("no_compact_boundary");
  }
  if (restore.diagnostics.fallbackToRaw) {
    warnings.push("restore_fallback_to_raw");
  }
  return warnings;
}

function buildTimelinePageWarnings(
  transcriptPage: SessionTranscriptPageReadResult,
): SessionTimelineWarningCode[] {
  const warnings: SessionTimelineWarningCode[] = [];
  if (transcriptPage.events.length === 0 && transcriptPage.cursorStatus === "initial") {
    warnings.push("transcript_empty");
  }
  if (transcriptPage.diagnostics.truncated) {
    warnings.push("transcript_truncated");
  }
  if (transcriptPage.diagnostics.corrupt) {
    warnings.push("transcript_corrupt");
  }
  if (transcriptPage.cursorStatus === "invalidated") {
    warnings.push("transcript_cursor_invalidated");
  }
  return warnings;
}

function resolvePreviewChars(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(24, Math.floor(value))
    : 120;
}

function resolveProjectedAt(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Date.now();
}

function buildTimelineItem(
  event: SessionTranscriptEvent,
  previewChars: number,
): SessionTimelinePageItem | undefined {
  if (isMessageEvent(event)) {
    const preview = buildPreview(event.payload.message.content, previewChars);
    return {
      kind: "message",
      eventId: event.eventId,
      eventType: event.type,
      createdAt: event.createdAt,
      messageId: event.payload.message.id,
      role: event.payload.message.role,
      contentPreview: preview.preview,
      contentLength: preview.length,
      truncated: preview.truncated,
      agentId: event.payload.message.agentId,
    };
  }

  if (isCompactBoundaryEvent(event)) {
    return {
      kind: "compact_boundary",
      eventId: event.eventId,
      eventType: event.type,
      createdAt: event.createdAt,
      boundaryId: event.payload.boundary.id,
      trigger: event.payload.boundary.trigger,
      tier: event.payload.boundary.tier,
      compactedMessageCount: event.payload.boundary.compactedMessageCount,
      preCompactTokenCount: event.payload.boundary.preCompactTokenCount,
      postCompactTokenCount: event.payload.boundary.postCompactTokenCount,
      tokenDelta: event.payload.boundary.preCompactTokenCount - event.payload.boundary.postCompactTokenCount,
      fallbackUsed: event.payload.boundary.fallbackUsed,
      rebuildTriggered: event.payload.boundary.rebuildTriggered,
      preservedSegment: { ...event.payload.boundary.preservedSegment },
      summaryRefKind: event.payload.summaryRef?.kind,
      partialCompactionViewId: event.payload.summaryRef?.partialCompactionViewId,
    };
  }

  if (!isPartialCompactionEvent(event)) {
    return undefined;
  }

  const view = event.payload.view;
  return {
    kind: "partial_compaction",
    eventId: event.eventId,
    eventType: event.type,
    createdAt: event.createdAt,
    boundaryId: event.payload.boundaryId,
    partialViewId: view.id,
    direction: view.direction,
    pivotMessageId: view.pivotMessageId,
    pivotMessageCount: view.pivotMessageCount,
    compactedMessageCount: view.compactedMessageCount,
    summaryMessageCount: view.summaryMessages.length,
    originalTokens: view.originalTokens,
    compactedTokens: view.compactedTokens,
    tokenDelta: view.originalTokens - view.compactedTokens,
    fallbackUsed: view.fallbackUsed,
    tier: view.tier,
  };
}

export function buildSessionTimelineProjection(
  input: BuildSessionTimelineProjectionInput,
): SessionTimelineProjection {
  const previewChars = resolvePreviewChars(input.previewChars);
  const projectedAt = resolveProjectedAt(input.projectedAt);
  const latestEventAt = input.transcriptEvents.length > 0
    ? input.transcriptEvents[input.transcriptEvents.length - 1]?.createdAt
    : undefined;

  const items: SessionTimelineItem[] = [];
  for (const event of input.transcriptEvents) {
    const item = buildTimelineItem(event, previewChars);
    if (item) {
      items.push(item);
    }
  }

  items.push({
    kind: "restore_result",
    createdAt: latestEventAt ?? projectedAt,
    source: input.restore.diagnostics.source,
    transcriptEventCount: input.restore.diagnostics.transcriptEventCount,
    transcriptMessageEventCount: input.restore.diagnostics.transcriptMessageEventCount,
    relinkApplied: input.restore.diagnostics.relinkApplied,
    fallbackToRaw: input.restore.diagnostics.fallbackToRaw,
    fallbackReason: input.restore.diagnostics.fallbackReason,
    boundaryId: input.restore.boundary?.id,
    partialViewId: input.restore.partialView?.id,
    rawMessageCount: input.restore.rawMessages.length,
    compactedViewCount: input.restore.compactedView.length,
    canonicalExtractionCount: input.restore.canonicalExtractionView.length,
  });

  const messageCount = input.transcriptEvents.filter(isMessageEvent).length;
  const compactBoundaryCount = input.transcriptEvents.filter(isCompactBoundaryEvent).length;
  const partialCompactionCount = input.transcriptEvents.filter(isPartialCompactionEvent).length;

  return {
    manifest: {
      schemaVersion: SESSION_TIMELINE_SCHEMA_VERSION,
      conversationId: input.conversationId,
      projectedAt,
      source: "conversation.timeline.get",
    },
    items,
    summary: {
      eventCount: input.transcriptEvents.length,
      itemCount: items.length,
      messageCount,
      compactBoundaryCount,
      partialCompactionCount,
      latestEventAt,
      restore: {
        source: input.restore.diagnostics.source,
        relinkApplied: input.restore.diagnostics.relinkApplied,
        fallbackToRaw: input.restore.diagnostics.fallbackToRaw,
        fallbackReason: input.restore.diagnostics.fallbackReason,
      },
      boundaryId: input.restore.boundary?.id,
      partialViewId: input.restore.partialView?.id,
    },
    warnings: buildWarnings(input.transcriptEvents, input.restore),
  };
}

export function buildSessionTimelinePage(
  input: BuildSessionTimelinePageInput,
): SessionTimelinePage {
  const previewChars = resolvePreviewChars(input.previewChars);
  const projectedAt = resolveProjectedAt(input.projectedAt);
  const transcriptEvents = input.transcriptPage.events;
  const latestEventAt = transcriptEvents.length > 0
    ? transcriptEvents[transcriptEvents.length - 1]?.createdAt
    : undefined;
  const items = transcriptEvents
    .map((event) => buildTimelineItem(event, previewChars))
    .filter((item): item is SessionTimelinePageItem => Boolean(item));

  return {
    manifest: {
      schemaVersion: SESSION_TIMELINE_SCHEMA_VERSION,
      conversationId: input.conversationId,
      projectedAt,
      source: "conversation.timeline.page",
      revision: input.transcriptPage.revision,
    },
    items,
    summary: {
      eventCount: transcriptEvents.length,
      itemCount: items.length,
      messageCount: transcriptEvents.filter(isMessageEvent).length,
      compactBoundaryCount: transcriptEvents.filter(isCompactBoundaryEvent).length,
      partialCompactionCount: transcriptEvents.filter(isPartialCompactionEvent).length,
      latestEventAt,
    },
    page: {
      pageSize: input.pageSize,
      cursorStatus: input.transcriptPage.cursorStatus,
      cursorInvalidationReason: input.transcriptPage.cursorInvalidationReason,
      nextCursor: input.transcriptPage.nextCursor,
    },
    warnings: buildTimelinePageWarnings(input.transcriptPage),
  };
}
