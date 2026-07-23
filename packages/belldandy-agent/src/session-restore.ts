import type { CompactionState } from "./compaction.js";
import {
  buildTranscriptRelinkedHistory,
  deriveTranscriptRelinkArtifacts,
  type TranscriptRelinkPartialCompactionView,
} from "./session-transcript-relink.js";
import type {
  SessionTranscriptEvent,
  SessionTranscriptMessageEvent,
  SessionTranscriptReadDiagnostics,
} from "./session-transcript.js";
import type { CompactBoundaryRecord, ConversationMessage, PartialCompactionViewRecord } from "./conversation.js";

export type SessionRestoreHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SessionRestoreDiagnostics = {
  source: "transcript" | "conversation_fallback";
  transcriptEventCount: number;
  transcriptMessageEventCount: number;
  transcriptUsed: boolean;
  relinkAttempted: boolean;
  relinkApplied: boolean;
  fallbackToRaw: boolean;
  fallbackReason?: "no_boundary" | "relink_failed";
  boundarySource?: "transcript" | "conversation_meta";
  partialViewSource?: "transcript" | "conversation_meta";
  transcriptRead?: SessionTranscriptReadDiagnostics;
};

export type SessionRestoreView = {
  conversationId: string;
  rawMessages: ConversationMessage[];
  compactedView: SessionRestoreHistoryMessage[];
  canonicalExtractionView: SessionRestoreHistoryMessage[];
  boundary?: CompactBoundaryRecord;
  partialView?: PartialCompactionViewRecord;
  diagnostics: SessionRestoreDiagnostics;
};

type BuildConversationRestoreViewInput = {
  conversationId: string;
  transcriptEvents: SessionTranscriptEvent[];
  conversationMessages: ConversationMessage[];
  compactionState: CompactionState;
  currentBoundary?: CompactBoundaryRecord;
  currentPartialView?: PartialCompactionViewRecord;
  transcriptReadDiagnostics?: SessionTranscriptReadDiagnostics;
};

function isTranscriptMessageEvent(event: SessionTranscriptEvent): event is SessionTranscriptMessageEvent {
  return event.type === "user_message_accepted" || event.type === "assistant_message_finalized";
}

function toHistory(messages: ConversationMessage[]): SessionRestoreHistoryMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function compareByCreatedAt<T extends { createdAt?: number }>(current: T | undefined, candidate: T | undefined): T | undefined {
  if (!candidate) return current;
  if (!current || Number(candidate.createdAt ?? 0) >= Number(current.createdAt ?? 0)) {
    return candidate;
  }
  return current;
}

function toTranscriptRelinkPartialView(view: PartialCompactionViewRecord | undefined): TranscriptRelinkPartialCompactionView | undefined {
  if (!view || view.direction !== "from") {
    return undefined;
  }
  return {
    ...view,
    direction: "from",
    summaryMessages: view.summaryMessages.map((message) => ({ ...message })),
  };
}

function restoreRawMessagesFromTranscript(events: SessionTranscriptEvent[]): ConversationMessage[] {
  return events
    .filter(isTranscriptMessageEvent)
    .map((event) => ({
      id: event.payload.message.id,
      role: event.payload.message.role,
      content: event.payload.message.content,
      timestamp: event.payload.message.timestamp,
      agentId: event.payload.message.agentId,
      clientContext: event.payload.message.clientContext,
    }));
}

export function buildConversationRestoreView(input: BuildConversationRestoreViewInput): SessionRestoreView {
  const transcriptRawMessages = restoreRawMessagesFromTranscript(input.transcriptEvents);
  const transcriptArtifacts = deriveTranscriptRelinkArtifacts(input.transcriptEvents);

  const rawMessages = transcriptRawMessages.length > 0
    ? transcriptRawMessages
    : input.conversationMessages.map((message) => ({ ...message }));
  const source: SessionRestoreDiagnostics["source"] = transcriptRawMessages.length > 0 ? "transcript" : "conversation_fallback";

  const boundary = compareByCreatedAt(input.currentBoundary, transcriptArtifacts.boundary as CompactBoundaryRecord | undefined);
  const partialView = compareByCreatedAt(input.currentPartialView, transcriptArtifacts.partialView as PartialCompactionViewRecord | undefined);

  const diagnostics: SessionRestoreDiagnostics = {
    source,
    transcriptEventCount: input.transcriptEvents.length,
    transcriptMessageEventCount: transcriptRawMessages.length,
    transcriptUsed: transcriptRawMessages.length > 0,
    relinkAttempted: false,
    relinkApplied: false,
    fallbackToRaw: false,
    boundarySource: transcriptArtifacts.boundary
      ? "transcript"
      : (input.currentBoundary ? "conversation_meta" : undefined),
    partialViewSource: transcriptArtifacts.partialView
      ? "transcript"
      : (input.currentPartialView ? "conversation_meta" : undefined),
    transcriptRead: input.transcriptReadDiagnostics,
  };

  const rawHistory = toHistory(rawMessages);
  let compactedView = rawHistory;

  if (boundary) {
    diagnostics.relinkAttempted = true;
    const relinked = buildTranscriptRelinkedHistory({
      messages: rawMessages,
      compactionState: input.compactionState,
      boundary,
      partialView: toTranscriptRelinkPartialView(partialView),
    });
    if (relinked) {
      compactedView = relinked.history;
      diagnostics.relinkApplied = true;
    } else {
      diagnostics.fallbackToRaw = true;
      diagnostics.fallbackReason = "relink_failed";
    }
  } else {
    diagnostics.fallbackReason = "no_boundary";
  }

  return {
    conversationId: input.conversationId,
    rawMessages,
    compactedView,
    canonicalExtractionView: rawHistory.filter((message) => typeof message.content === "string" && message.content.trim().length > 0),
    boundary,
    partialView,
    diagnostics,
  };
}
