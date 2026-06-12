import type { AgentPromptDelta, BeforeAgentStartResult } from "@belldandy/agent";

import { parseGoalSessionKey } from "./goals/session.js";
import { buildMemoryFreshnessView, buildProfileSemanticFreshnessView } from "./memory-freshness-view.js";
import { buildMindProfileRuntimeDigest } from "./mind-profile-runtime-digest.js";
import { buildMindProfileSnapshot, type MindProfileSnapshot } from "./mind-profile-snapshot.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";

type MindProfileRuntimeSessionKind = "main" | "goal" | "goal_node";

export type MindProfileRuntimePreludeConfig = {
  enabled: boolean;
  maxLines: number;
  maxLineLength: number;
  maxChars: number;
  minSignalCount: number;
};

function truncateText(value: string | undefined, maxLength = 72): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

function resolveSessionKind(sessionKey?: string): MindProfileRuntimeSessionKind {
  const goalSession = parseGoalSessionKey(sessionKey);
  if (goalSession?.kind === "goal") return "goal";
  if (goalSession?.kind === "goal_node") return "goal_node";
  return "main";
}

function normalizeText(value: string | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function buildCanonicalProfileStateLines(input: {
  snapshot: MindProfileSnapshot;
  maxLines: number;
  maxLineLength: number;
}): {
  lines: string[];
  paths: string[];
  hasIdentityState: boolean;
  hasNonIdentityState: boolean;
} {
  const entries = Array.isArray(input.snapshot.profile.stateEntries)
    ? input.snapshot.profile.stateEntries
    : [];
  const preferredEntries = entries.filter((entry) => !String(entry?.path ?? "").startsWith("identity."));
  const orderedEntries = preferredEntries.length > 0
    ? [...preferredEntries, ...entries.filter((entry) => String(entry?.path ?? "").startsWith("identity."))]
    : entries;
  const lines: string[] = [];
  const paths: string[] = [];
  let hasIdentityState = false;
  let hasNonIdentityState = false;

  for (const entry of orderedEntries) {
    if (!entry?.path || !entry?.valueText) {
      continue;
    }
    const pathText = normalizeText(entry.path);
    const valueText = truncateText(normalizeText(entry.valueText), Math.max(16, input.maxLineLength - pathText.length - 3));
    if (!pathText || !valueText) {
      continue;
    }
    lines.push(`${pathText} = ${valueText}`);
    paths.push(pathText);
    if (pathText.startsWith("identity.")) {
      hasIdentityState = true;
    } else {
      hasNonIdentityState = true;
    }
    if (lines.length >= input.maxLines) {
      break;
    }
  }

  return {
    lines,
    paths,
    hasIdentityState,
    hasNonIdentityState,
  };
}

function buildMindProfileRuntimeBlock(input: {
  profileStateLines: string[];
  summaryLines: string[];
  maxLines: number;
  maxLineLength: number;
  maxChars: number;
}): {
  block: string;
  lineCount: number;
  charCount: number;
  profileStateLineCount: number;
  summaryLineCount: number;
} {
  const maxLines = Math.max(1, input.maxLines);
  const maxChars = Math.max(80, input.maxChars);
  const sections: Array<{ tag: string; lines: string[] }> = [];
  let remainingLines = maxLines;
  let remainingChars = maxChars;

  // 先放 canonical profile state，确保模型先看到真值层，再看摘要层。
  const appendSection = (tag: string, rawLines: string[]) => {
    if (remainingLines <= 0 || remainingChars < 16) {
      return;
    }
    const lines: string[] = [];
    for (const rawLine of rawLines) {
      if (remainingLines <= 0 || remainingChars < 16) {
        break;
      }
      const line = truncateText(normalizeText(rawLine), Math.min(input.maxLineLength, remainingChars));
      if (!line) {
        continue;
      }
      lines.push(line);
      remainingLines -= 1;
      remainingChars -= line.length;
    }
    if (lines.length > 0) {
      sections.push({ tag, lines });
    }
  };

  appendSection("canonical-profile-state", input.profileStateLines);
  appendSection("runtime-summary", input.summaryLines);

  const blockLines = sections.flatMap((section) => [
    `<${section.tag}>`,
    ...section.lines,
    `</${section.tag}>`,
  ]);
  const block = `<mind-profile-runtime hint="以下是稳定用户画像真值与长期记忆的运行时锚点；优先相信 canonical profile state。若与当前请求无关，不要机械复述。">\n${blockLines.join("\n")}\n</mind-profile-runtime>`;

  return {
    block,
    lineCount: sections.reduce((sum, section) => sum + section.lines.length, 0),
    charCount: sections.reduce((sum, section) => sum + section.lines.reduce((lineSum, line) => lineSum + line.length, 0), 0),
    profileStateLineCount: sections.find((section) => section.tag === "canonical-profile-state")?.lines.length ?? 0,
    summaryLineCount: sections.find((section) => section.tag === "runtime-summary")?.lines.length ?? 0,
  };
}

function createMindProfileRuntimeDelta(input: {
  text: string;
  lineCount: number;
  metadata?: Record<string, unknown>;
}): AgentPromptDelta {
  return {
    id: "mind-profile-runtime",
    deltaType: "user-prelude",
    role: "user-prelude",
    source: "mind-profile-runtime",
    text: input.text,
    metadata: {
      blockTag: "mind-profile-runtime",
      lineCount: input.lineCount,
      ...(input.metadata ?? {}),
    },
  };
}

export async function buildMindProfileRuntimePrelude(input: {
  stateDir: string;
  agentId?: string;
  sessionKey?: string;
  currentTurnText?: string;
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  config: MindProfileRuntimePreludeConfig;
}): Promise<BeforeAgentStartResult | undefined> {
  const sessionKind = resolveSessionKind(input.sessionKey);
  if (!input.config.enabled || sessionKind !== "main") {
    return undefined;
  }

  const mindProfileSnapshot = await buildMindProfileSnapshot({
    stateDir: input.stateDir,
    residentMemoryManagers: input.residentMemoryManagers,
    agentId: input.agentId,
  });
  const profileStateLineBudget = Math.min(3, Math.max(1, input.config.maxLines - 1));
  const canonicalProfileState = buildCanonicalProfileStateLines({
    snapshot: mindProfileSnapshot,
    maxLines: profileStateLineBudget,
    maxLineLength: input.config.maxLineLength,
  });
  const digest = buildMindProfileRuntimeDigest(mindProfileSnapshot, {
    maxLines: input.config.maxLines,
    maxLineLength: input.config.maxLineLength,
    maxChars: input.config.maxChars,
  });
  const memoryFreshness = buildMemoryFreshnessView({
    items: [buildProfileSemanticFreshnessView(mindProfileSnapshot)],
  });
  const digestSummaryLines = digest.lines.filter((line) => {
    if (canonicalProfileState.hasNonIdentityState && line.startsWith("Profile anchor:")) {
      return false;
    }
    if (canonicalProfileState.hasIdentityState && line.startsWith("User anchor:")) {
      return false;
    }
    return true;
  });
  const meetsSignalThreshold = digest.summary.available && digest.summary.signalCount >= input.config.minSignalCount;
  const hasCanonicalProfileState = canonicalProfileState.lines.length > 0;
  if (!meetsSignalThreshold && !hasCanonicalProfileState) {
    return undefined;
  }

  const runtimeBlock = buildMindProfileRuntimeBlock({
    profileStateLines: canonicalProfileState.lines,
    summaryLines: digestSummaryLines,
    maxLines: input.config.maxLines,
    maxLineLength: input.config.maxLineLength,
    maxChars: input.config.maxChars,
  });
  if (runtimeBlock.lineCount <= 0) {
    return undefined;
  }

  return {
    prependContext: runtimeBlock.block,
    deltas: [
      createMindProfileRuntimeDelta({
        text: runtimeBlock.block,
        lineCount: runtimeBlock.lineCount,
        metadata: {
          agentId: input.agentId?.trim() || "default",
          sessionKind,
          signalCount: digest.summary.signalCount,
          charCount: runtimeBlock.charCount,
          includedSignals: digest.summary.includedSignals,
          headline: digest.summary.headline,
          activationReason: meetsSignalThreshold ? "signal_threshold" : "profile_state_present",
          profileStateLineCount: runtimeBlock.profileStateLineCount,
          summaryLineCount: runtimeBlock.summaryLineCount,
          profileStatePaths: canonicalProfileState.paths,
          currentTurnPreview: truncateText(input.currentTurnText, 96) || undefined,
          ...(memoryFreshness.summary.available ? { memoryFreshness } : {}),
        },
      }),
    ],
  };
}
