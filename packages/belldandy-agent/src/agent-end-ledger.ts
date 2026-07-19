import { redactSensitiveText, redactSensitiveValue, type JsonObject } from "@belldandy/protocol";

import type { AgentBudgetExhausted, AgentFinal, AgentStatus, AgentStreamItem, AgentUsage } from "./index.js";

export type AgentEndLedgerSummary = {
  truncated: boolean;
  eventCount: number;
  retainedEventCount: number;
  droppedEventCount: number;
  totalDeltaChars: number;
};

export type AgentEndLedgerSnapshot = {
  items: AgentStreamItem[];
  summary: AgentEndLedgerSummary;
};

export type AgentEndLedgerOptions = {
  headEvents?: number;
  tailEvents?: number;
  maxItemBytes?: number;
};

const DEFAULT_OPTIONS: Required<AgentEndLedgerOptions> = {
  headEvents: 64,
  tailEvents: 64,
  maxItemBytes: 4096,
};

/**
 * agent_end/afterRun 的旁路账本。它不参与用户流式输出，只负责防止 Hook 在 run
 * 结束前保留所有 delta 与 Tool 结果。超过容量后仍保留首尾证据和终态事件。
 */
export class AgentEndLedger {
  private readonly options: Required<AgentEndLedgerOptions>;
  private readonly head: AgentStreamItem[] = [];
  private readonly tail: AgentStreamItem[] = [];
  private latestFinal?: AgentFinal;
  private latestStatus?: AgentStatus;
  private latestBudgetExhausted?: AgentBudgetExhausted;
  private latestUsage?: AgentUsage;
  private eventCount = 0;
  private totalDeltaChars = 0;
  private itemTruncated = false;

  constructor(options: AgentEndLedgerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  record(item: AgentStreamItem): void {
    this.eventCount += 1;
    if (item.type === "delta") {
      this.totalDeltaChars += item.delta.length;
    }

    const bounded = this.boundItem(item);
    if (this.head.length < this.options.headEvents) {
      this.head.push(bounded);
    } else {
      this.tail.push(bounded);
      if (this.tail.length > this.options.tailEvents) {
        this.tail.shift();
      }
    }

    if (bounded.type === "final") this.latestFinal = bounded;
    if (bounded.type === "status") this.latestStatus = bounded;
    if (bounded.type === "budget_exhausted") this.latestBudgetExhausted = bounded;
    if (bounded.type === "usage") this.latestUsage = bounded;
  }

  snapshot(): AgentEndLedgerSnapshot {
    const items = [...this.head, ...this.tail];
    this.appendTerminalItem(items, this.latestBudgetExhausted);
    this.appendTerminalItem(items, this.latestFinal);
    this.appendTerminalItem(items, this.latestUsage);
    this.appendTerminalItem(items, this.latestStatus);
    const retainedEventCount = items.length;
    const droppedEventCount = Math.max(0, this.eventCount - retainedEventCount);
    return {
      items,
      summary: {
        truncated: this.itemTruncated || droppedEventCount > 0,
        eventCount: this.eventCount,
        retainedEventCount,
        droppedEventCount,
        totalDeltaChars: this.totalDeltaChars,
      },
    };
  }

  private appendTerminalItem(items: AgentStreamItem[], item: AgentStreamItem | undefined): void {
    if (item && !items.includes(item)) {
      items.push(item);
    }
  }

  private boundItem(item: AgentStreamItem): AgentStreamItem {
    switch (item.type) {
      case "delta":
        return { ...item, delta: this.boundText(item.delta) };
      case "final":
        return { ...item, text: this.boundText(item.text) };
      case "tool_call":
        return {
          ...item,
          arguments: redactSensitiveValue(item.arguments, {
            maxDepth: 6,
            maxKeys: 50,
            maxArrayEntries: 50,
            maxStringBytes: this.options.maxItemBytes,
            maxTotalBytes: this.options.maxItemBytes,
          }) as JsonObject,
        };
      case "tool_result":
        return {
          ...item,
          output: this.boundText(item.output),
          ...(item.error ? { error: this.boundText(item.error) } : {}),
          ...(item.metadata ? {
            metadata: redactSensitiveValue(item.metadata, {
              maxDepth: 6,
              maxKeys: 50,
              maxArrayEntries: 50,
              maxStringBytes: this.options.maxItemBytes,
              maxTotalBytes: this.options.maxItemBytes,
            }) as JsonObject,
          } : {}),
        };
      default:
        return item;
    }
  }

  private boundText(value: string): string {
    const safeValue = redactSensitiveText(value);
    const encoded = new TextEncoder().encode(safeValue);
    if (encoded.byteLength <= this.options.maxItemBytes) {
      return safeValue;
    }
    this.itemTruncated = true;
    const marker = "[TRUNCATED]";
    const markerBytes = new TextEncoder().encode(marker).byteLength;
    const allowedBytes = Math.max(0, this.options.maxItemBytes - markerBytes);
    let result = "";
    let usedBytes = 0;
    for (const character of safeValue) {
      const bytes = new TextEncoder().encode(character).byteLength;
      if (usedBytes + bytes > allowedBytes) break;
      result += character;
      usedBytes += bytes;
    }
    return `${result}${marker}`;
  }
}
