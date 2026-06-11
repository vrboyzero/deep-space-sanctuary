import type { MindProfileSnapshot } from "./mind-profile-snapshot.js";

export type MindProfileRuntimeDigestSignal =
  | "identity"
  | "profile"
  | "memory"
  | "conversation"
  | "experience";

export type MindProfileRuntimeDigest = {
  summary: {
    available: boolean;
    headline: string;
    lineCount: number;
    charCount: number;
    signalCount: number;
    includedSignals: MindProfileRuntimeDigestSignal[];
    maxLines: number;
    maxChars: number;
  };
  lines: string[];
};

export type MindProfileRuntimeDigestOptions = {
  maxLines?: number;
  maxLineLength?: number;
  maxChars?: number;
};

type DigestCandidate = {
  signal: MindProfileRuntimeDigestSignal;
  text?: string;
};

function normalizeText(value: string | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string | undefined, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatUserAnchor(snapshot: MindProfileSnapshot): string | undefined {
  const userName = truncateText(snapshot.identity.userName, 48);
  const userAvatar = truncateText(snapshot.identity.userAvatar, 24);
  if (!userName && !userAvatar) return undefined;
  return userAvatar ? `User anchor: ${userName || "-"} / ${userAvatar}` : `User anchor: ${userName}`;
}

function formatProfileAnchor(snapshot: MindProfileSnapshot): string | undefined {
  const profileLine = snapshot.profile.stateSummaryLines?.find((item) => normalizeText(item))
    ?? snapshot.profile.treeSummaryLines?.find((item) => normalizeText(item))
    ?? snapshot.profile.summaryLines.find((item) => normalizeText(item));
  if (!profileLine) return undefined;
  return `Profile anchor: ${profileLine}`;
}

function formatMemoryAnchor(snapshot: MindProfileSnapshot): string | undefined {
  const privateCount = Number(snapshot.memory.privateMemoryCount) || 0;
  const sharedCount = Number(snapshot.memory.sharedMemoryCount) || 0;
  const recent = snapshot.memory.recentMemorySnippets
    .map((item) => normalizeText(item.text))
    .filter(Boolean)
    .slice(0, 2);
  if (privateCount + sharedCount <= 0 && recent.length <= 0) return undefined;
  const suffix = recent.length > 0 ? `, recent=${recent.join(" | ")}` : "";
  return `Durable memory: private=${privateCount}, shared=${sharedCount}${suffix}`;
}

function formatConversationAnchor(snapshot: MindProfileSnapshot): string | undefined {
  const activeCount = Number(snapshot.conversation.activeResidentCount) || 0;
  const digestReadyCount = Number(snapshot.conversation.digestReadyCount) || 0;
  const digestUpdatedCount = Number(snapshot.conversation.digestUpdatedCount) || 0;
  const topHeadline = snapshot.conversation.topResidents
    .map((item) => normalizeText(item.headline))
    .find(Boolean);
  if (activeCount <= 0 && !topHeadline) return undefined;
  const summary = `Residents: active=${activeCount}, digest=${digestReadyCount}/${digestUpdatedCount}`;
  return topHeadline ? `${summary}, top=${topHeadline}` : summary;
}

function formatExperienceAnchor(snapshot: MindProfileSnapshot): string | undefined {
  const usageLinkedCount = Number(snapshot.experience.usageLinkedCount) || 0;
  const topHeadline = snapshot.experience.topUsageResidents
    .map((item) => normalizeText(item.headline))
    .find(Boolean);
  if (usageLinkedCount <= 0 && !topHeadline) return undefined;
  return topHeadline ? `Experience anchor: ${topHeadline}` : `Experience anchor: linked=${usageLinkedCount}`;
}

export function buildMindProfileRuntimeDigest(
  snapshot: MindProfileSnapshot | undefined,
  options: MindProfileRuntimeDigestOptions = {},
): MindProfileRuntimeDigest {
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? 4));
  const maxLineLength = Math.max(24, Math.floor(options.maxLineLength ?? 120));
  const maxChars = Math.max(80, Math.floor(options.maxChars ?? 360));

  if (!snapshot?.summary.available) {
    return {
      summary: {
        available: false,
        headline: "mind profile runtime digest is empty",
        lineCount: 0,
        charCount: 0,
        signalCount: 0,
        includedSignals: [],
        maxLines,
        maxChars,
      },
      lines: [],
    };
  }

  const candidates: DigestCandidate[] = [
    { signal: "identity", text: formatUserAnchor(snapshot) },
    { signal: "profile", text: formatProfileAnchor(snapshot) },
    { signal: "memory", text: formatMemoryAnchor(snapshot) },
    { signal: "conversation", text: formatConversationAnchor(snapshot) },
    { signal: "experience", text: formatExperienceAnchor(snapshot) },
  ];

  const lines: string[] = [];
  const includedSignals: MindProfileRuntimeDigestSignal[] = [];
  const seen = new Set<string>();
  let charCount = 0;

  for (const candidate of candidates) {
    if (lines.length >= maxLines) break;
    const normalized = truncateText(candidate.text, maxLineLength);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;

    const remainingChars = maxChars - charCount;
    if (remainingChars < 24) break;
    const line = normalized.length > remainingChars
      ? truncateText(normalized, remainingChars)
      : normalized;
    if (!line) continue;

    seen.add(normalized);
    lines.push(line);
    charCount += line.length;
    if (!includedSignals.includes(candidate.signal)) {
      includedSignals.push(candidate.signal);
    }
    if (charCount >= maxChars) break;
  }

  return {
    summary: {
      available: lines.length > 0,
      headline: lines.length > 0
        ? `signals=${includedSignals.join("/") || "none"}; lines=${lines.length}; chars=${charCount}`
        : "mind profile runtime digest is empty",
      lineCount: lines.length,
      charCount,
      signalCount: includedSignals.length,
      includedSignals,
      maxLines,
      maxChars,
    },
    lines,
  };
}
