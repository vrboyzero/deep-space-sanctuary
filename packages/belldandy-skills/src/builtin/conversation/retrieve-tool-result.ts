import crypto from "node:crypto";

import type { RecentToolResultRecord, Tool, ToolCallResult } from "../../types.js";
import { withToolContract } from "../../tool-contract.js";
import {
  formatConversationAccessDenied,
  formatTimestamp,
  isConversationAllowed,
  normalizeAllowedConversationKinds,
  normalizeOptionalString,
  parseBoolean,
  parsePositiveInt,
  truncateText,
} from "./shared.js";

type ToolResultViewMode = "summary" | "head" | "tail" | "full";

function formatArgs(record: RecentToolResultRecord): string {
  if (!record.args || typeof record.args !== "object") return "-";
  try {
    const raw = JSON.stringify(record.args);
    return truncateText(raw, 220) || "-";
  } catch {
    return "-";
  }
}

function renderContent(record: RecentToolResultRecord, mode: ToolResultViewMode, chars: number): string {
  const source = record.success ? (record.content ?? "") : (record.error ?? record.content ?? "");
  if (!source.trim()) return "-";
  if (mode === "full") return source;
  if (mode === "summary") return truncateText(record.summary || source, chars);
  if (source.length <= chars) return source;
  if (mode === "head") {
    return `${source.slice(0, Math.max(0, chars - 3))}...`;
  }
  return `...${source.slice(Math.max(0, source.length - (chars - 3)))}`;
}

function renderContentMeta(record: RecentToolResultRecord): string {
  const chars = record.success ? record.contentChars : (record.errorChars ?? record.contentChars);
  const truncated = record.success ? record.contentTruncated : (record.errorTruncated ?? record.contentTruncated);
  const preview = record.success ? record.contentPreview : (record.errorPreview ?? record.contentPreview);
  const details = [];
  if (typeof chars === "number" && Number.isFinite(chars) && chars > 0) {
    details.push(`chars=${chars}`);
  }
  if (truncated) {
    details.push("stored=preview");
  }
  if (preview && truncated) {
    details.push("recover=truncated");
  }
  return details.length > 0 ? details.join(" ") : "-";
}

function renderRecords(records: RecentToolResultRecord[], mode: ToolResultViewMode, chars: number): string {
  if (records.length === 0) {
    return "No recent tool results matched the current filters.";
  }
  return [
    `Recent Tool Results: ${records.length}`,
    "",
    ...records.map((record, index) => [
      `- ${index + 1}. tool=${record.toolName} call_id=${record.toolCallId}`,
      `  created_at=${formatTimestamp(record.createdAt)} success=${record.success ? "yes" : "no"} synthetic=${record.isSynthetic ? "yes" : "no"}`,
      `  failure_kind=${record.failureKind || "-"} target=${record.target || "-"}`,
      `  summary=${truncateText(record.summary, 280)}`,
      `  args=${formatArgs(record)}`,
      `  content_meta=${renderContentMeta(record)}`,
      `  content=${renderContent(record, mode, chars)}`,
    ].join("\n")),
  ].join("\n");
}

export const retrieveToolResultTool: Tool = withToolContract({
  definition: {
    name: "retrieve_tool_result",
    description: "Read recent persisted tool results for the current or a known conversation so compressed tool outputs remain recoverable.",
    parameters: {
      type: "object",
      properties: {
        conversation_id: {
          type: "string",
          description: "Exact conversation ID to inspect. Defaults to the current conversation.",
        },
        tool_call_id: {
          type: "string",
          description: "Exact tool_call_id to retrieve.",
        },
        tool_name: {
          type: "string",
          description: "Filter to a specific tool name, such as file_read or run_command.",
        },
        query: {
          type: "string",
          description: "Optional case-insensitive text filter over summary, target, content, and error.",
        },
        success: {
          type: "boolean",
          description: "Optional success filter.",
        },
        limit: {
          type: "number",
          description: "Maximum number of records to return. Default: 3.",
        },
        mode: {
          type: "string",
          enum: ["summary", "head", "tail", "full"],
          description: "How much of each stored tool result to render. Default: summary.",
        },
        chars: {
          type: "number",
          description: "Character budget for summary/head/tail rendering. Default: 600.",
        },
      },
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "retrieve_tool_result";
    const conversationStore = context.conversationStore;

    if (!conversationStore?.getRecentToolResults) {
      return {
        id,
        name,
        success: false,
        output: "",
        error: "Recent tool result retrieval is not available in the current runtime.",
        durationMs: Date.now() - start,
      };
    }

    try {
      const conversationId = normalizeOptionalString(args.conversation_id) ?? context.conversationId;
      const allowedConversationKinds = normalizeAllowedConversationKinds(context.allowedConversationKinds);
      if (!isConversationAllowed(conversationId, allowedConversationKinds)) {
        return {
          id,
          name,
          success: false,
          output: "",
          error: formatConversationAccessDenied(conversationId, allowedConversationKinds),
          durationMs: Date.now() - start,
        };
      }

      const toolCallId = normalizeOptionalString(args.tool_call_id);
      const toolName = normalizeOptionalString(args.tool_name);
      const query = normalizeOptionalString(args.query);
      const success = parseBoolean(args.success);
      const limit = parsePositiveInt(args.limit, toolCallId ? 1 : 3, { min: 1, max: 10 });
      const chars = parsePositiveInt(args.chars, 600, { min: 120, max: 12_000 });
      const modeValue = normalizeOptionalString(args.mode) ?? "summary";
      const mode = (["summary", "head", "tail", "full"].includes(modeValue) ? modeValue : "summary") as ToolResultViewMode;

      const records = conversationStore.getRecentToolResults(conversationId, {
        limit,
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolName ? { toolName } : {}),
        ...(typeof success === "boolean" ? { success } : {}),
        ...(query ? { query } : {}),
      });

      return {
        id,
        name,
        success: true,
        output: renderRecords(records, mode, chars),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        id,
        name,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  },
}, {
  family: "memory",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Retrieve recent persisted tool results so compressed outputs remain inspectable",
  resultSchema: {
    kind: "text",
    description: "Recent tool result records with summary and recoverable output/error content.",
  },
  outputPersistencePolicy: "conversation",
});
