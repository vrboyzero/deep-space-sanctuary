import type { SummarizerContext } from "@belldandy/agent";

export function buildCacheAlignedSummaryInstruction(context: SummarizerContext): string {
  return [
    context.prompt.trim(),
    "",
    "<<CACHE_BREAK>>",
    "The prior replayed content exists to preserve prefix-cache alignment for the summarizer request.",
    "Use that replayed content as the source of truth and return ONLY the requested markdown summary.",
  ].join("\n").trim();
}

export function buildCacheAlignedChatMessages(
  context: SummarizerContext,
  instruction: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (context.mode === "rolling") {
    if (context.existingSummary?.trim()) {
      messages.push({
        role: "assistant",
        content: `## Existing Summary\n${context.existingSummary.trim()}`,
      });
    }
    for (const message of context.newMessages ?? []) {
      messages.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      });
    }
  } else {
    if (context.existingArchivalSummary?.trim()) {
      messages.push({
        role: "assistant",
        content: `## Existing Archival Summary\n${context.existingArchivalSummary.trim()}`,
      });
    }
    if (context.rollingSummary?.trim()) {
      messages.push({
        role: "assistant",
        content: `## Rolling Summary To Archive\n${context.rollingSummary.trim()}`,
      });
    }
  }
  messages.push({
    role: "user",
    content: instruction,
  });
  return messages;
}

export function buildCacheAlignedResponsesInput(
  context: SummarizerContext,
  instruction: string,
): Array<Record<string, unknown>> {
  return buildCacheAlignedChatMessages(context, instruction).map((message) => ({
    type: "message",
    role: message.role,
    content: message.content,
  }));
}
