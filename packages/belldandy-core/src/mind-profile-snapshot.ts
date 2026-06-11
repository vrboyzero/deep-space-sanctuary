import fs from "node:fs/promises";
import path from "node:path";

import { extractIdentityInfo } from "@belldandy/agent";
import type { ProfileStateEntry } from "@belldandy/memory";

import type { ResidentAgentDoctorReport } from "./resident-agent-observability.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";

type MindProfileResidentView = {
  agentId: string;
  displayName: string;
  status?: string;
  conversationId?: string;
  digestStatus?: string;
  pendingMessageCount: number;
  headline: string;
};

type MindProfileExperienceView = {
  agentId: string;
  displayName: string;
  usageCount: number;
  headline: string;
};

type MindProfileMemorySnippetView = {
  scope: "private" | "shared";
  sourcePath: string;
  text: string;
};

type MindProfileTreeNodeView = {
  nodeId: string;
  kind: "profile" | "global";
  title?: string;
  summary: string;
  chunkCount: number;
  updatedAt?: string;
};

type MindProfileStateEntryView = {
  path: string;
  valueText: string;
  confidence?: number;
  updatedAt?: string;
  lastConfirmedAt?: string;
};

export type MindProfileSnapshot = {
  summary: {
    available: boolean;
    selectedAgentId: string;
    headline: string;
    activeResidentCount: number;
    digestReadyCount: number;
    digestUpdatedCount: number;
    usageLinkedCount: number;
    privateMemoryCount: number;
    sharedMemoryCount: number;
    summaryLineCount: number;
    hasUserProfile: boolean;
    hasPrivateMemoryFile: boolean;
    hasSharedMemoryFile: boolean;
  };
  identity: {
    userName?: string;
    userAvatar?: string;
    hasUserProfile: boolean;
    hasPrivateMemoryFile: boolean;
    hasSharedMemoryFile: boolean;
  };
  conversation: {
    activeResidentCount: number;
    digestReadyCount: number;
    digestUpdatedCount: number;
    topResidents: MindProfileResidentView[];
  };
  memory: {
    privateMemoryCount: number;
    sharedMemoryCount: number;
    privateSummary: string;
    sharedSummary: string;
    recentMemorySnippets: MindProfileMemorySnippetView[];
  };
  experience: {
    usageLinkedCount: number;
    topUsageResidents: MindProfileExperienceView[];
  };
  profile: {
    headline: string;
    summaryLines: string[];
    stateSummaryLines?: string[];
    stateEntries?: MindProfileStateEntryView[];
    treeSummaryLines?: string[];
    treeNodes?: MindProfileTreeNodeView[];
  };
};

function truncateText(value: string | undefined, maxLength = 96): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

function toPlainLine(value: string | undefined): string {
  return truncateText(
    String(value ?? "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/[_>#-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractMeaningfulLines(content: string | undefined, maxLines = 2): string[] {
  if (!content) return [];
  const lines: string[] = [];
  for (const rawLine of content.split(/\r?\n/g)) {
    const normalized = toPlainLine(rawLine);
    if (!normalized) continue;
    if (/^(名字|头像|Emoji|Name|Avatar)\s*[：:]/i.test(normalized)) continue;
    if (/^(user|profile|memory)\s*$/i.test(normalized)) continue;
    lines.push(normalized);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

async function readTextFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function dedupeStrings(values: Array<string | undefined>, limit = values.length): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = truncateText(value, 160);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
    if (items.length >= limit) break;
  }
  return items;
}

function buildResidentHeadline(agent: NonNullable<ResidentAgentDoctorReport["agents"]>[number]): string {
  const status = agent.status || "idle";
  const digestStatus = agent.conversationDigest?.status || "missing";
  const pendingMessageCount = Number(agent.conversationDigest?.pendingMessageCount) || 0;
  return `${agent.displayName || agent.id}: status=${status}, digest=${digestStatus}, pending=${pendingMessageCount}`;
}

function buildExperienceHeadline(agent: NonNullable<ResidentAgentDoctorReport["agents"]>[number]): string {
  const digest = agent.experienceUsageDigest;
  const usageCount = Number(digest?.usageCount) || 0;
  const methodCount = Number(digest?.methodCount) || 0;
  const skillCount = Number(digest?.skillCount) || 0;
  const latestAssetKey = truncateText(digest?.latestAssetKey, 72);
  return `${agent.displayName || agent.id}: usage=${usageCount}, methods=${methodCount}, skills=${skillCount}${latestAssetKey ? `, latest=${latestAssetKey}` : ""}`;
}

function buildMemorySnippetText(item: { snippet?: string; summary?: string; content?: string }): string {
  return truncateText(toPlainLine(item.summary || item.snippet || item.content), 100);
}

function buildTreeNodeSummaryLine(node: MindProfileTreeNodeView): string {
  const label = node.kind === "profile" ? "Profile tree" : "Global tree";
  const summary = truncateText(toPlainLine(node.summary), 140);
  if (!summary) {
    return "";
  }
  const evidenceSuffix = node.chunkCount > 0 ? `, evidence=${node.chunkCount}` : "";
  return `${label}: ${summary}${evidenceSuffix}`;
}

function buildMemorySummary(options: {
  label: string;
  count: number;
  fileSummary?: string;
  recentSnippets: MindProfileMemorySnippetView[];
}): string {
  const parts = [`${options.label} ${options.count} chunk(s)`];
  if (options.fileSummary) {
    parts.push(`file=${options.fileSummary}`);
  }
  if (options.recentSnippets.length > 0) {
    parts.push(`latest=${options.recentSnippets.map((item) => item.text).join(" | ")}`);
  }
  return parts.join(", ");
}

function isIdentityProfilePath(profilePath: string): boolean {
  return profilePath === "identity.name" || profilePath === "identity.avatar";
}

function readProfileStateValueText(value: unknown): string {
  if (typeof value === "string") {
    return truncateText(toPlainLine(value), 100);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return truncateText(value.map((item) => toPlainLine(String(item))).filter(Boolean).join(", "), 100);
  }
  if (value && typeof value === "object") {
    try {
      return truncateText(toPlainLine(JSON.stringify(value)), 100);
    } catch {
      return "";
    }
  }
  return "";
}

function profileStatePathPriority(profilePath: string): number {
  if (profilePath === "identity.name") return 0;
  if (profilePath === "identity.avatar") return 1;
  if (profilePath.startsWith("preferences.")) return 10;
  if (profilePath.startsWith("workstyle.")) return 20;
  if (profilePath.startsWith("relationship.")) return 30;
  return 100;
}

function buildProfileStateView(entries: ProfileStateEntry[]): {
  userName?: string;
  userAvatar?: string;
  stateEntries: MindProfileStateEntryView[];
  stateSummaryLines: string[];
} {
  const sortedEntries = entries
    .slice()
    .sort((left, right) => {
      const priorityDelta = profileStatePathPriority(left.path) - profileStatePathPriority(right.path);
      if (priorityDelta !== 0) return priorityDelta;
      return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
    });
  const userName = sortedEntries.find((item) => item.path === "identity.name" && typeof item.value === "string")?.value as string | undefined;
  const userAvatar = sortedEntries.find((item) => item.path === "identity.avatar" && typeof item.value === "string")?.value as string | undefined;
  const stateEntries = sortedEntries
    .map((entry) => ({
      path: entry.path,
      valueText: readProfileStateValueText(entry.value),
      confidence: entry.confidence,
      updatedAt: entry.updatedAt,
      lastConfirmedAt: entry.lastConfirmedAt,
    }))
    .filter((entry) => entry.valueText);
  const preferred = stateEntries.filter((entry) => !isIdentityProfilePath(entry.path));
  const summarySource = preferred.length > 0 ? preferred : stateEntries;
  const stateSummaryLines = summarySource
    .slice(0, 3)
    .map((entry) => `Profile state: ${entry.path} = ${entry.valueText}`);
  return {
    userName,
    userAvatar,
    stateEntries: stateEntries.slice(0, 6),
    stateSummaryLines,
  };
}

function resolveSelectedRecord(
  residentMemoryManagers: ScopedMemoryManagerRecord[] | undefined,
  agentId?: string,
): ScopedMemoryManagerRecord | undefined {
  const records = Array.isArray(residentMemoryManagers) ? residentMemoryManagers : [];
  if (records.length <= 0) return undefined;
  if (agentId) {
    const matched = records.find((record) => record.agentId === agentId);
    if (matched) return matched;
  }
  return records.find((record) => record.agentId === "default") ?? records[0];
}

function readNodeChunkCount(metadata: Record<string, unknown> | undefined): number {
  const candidates = [
    metadata?.chunkCount,
    metadata?.totalChunkCount,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return 0;
}

async function listMindProfileTreeNodes(
  selectedRecord: ScopedMemoryManagerRecord | undefined,
  selectedAgentId: string,
): Promise<MindProfileTreeNodeView[]> {
  const manager = selectedRecord?.manager;
  if (!manager) {
    return [];
  }

  const readNodes = (): MindProfileTreeNodeView[] => {
    const nodes = [
      manager.listMemoryTreeNodes(1, { kind: "profile", agentId: selectedAgentId })[0],
      manager.listMemoryTreeNodes(1, { kind: "global" })[0],
    ].filter(Boolean);
    return nodes.map((node) => ({
      nodeId: node!.id,
      kind: node!.kind === "global" ? "global" as const : "profile" as const,
      title: node!.title,
      summary: node!.summary,
      chunkCount: readNodeChunkCount(node!.metadata),
      updatedAt: node!.updatedAt ?? node!.timeTo ?? node!.timeFrom,
    })).filter((node) => node.summary.trim().length > 0);
  };

  const managedKinds: Array<"profile" | "global"> = ["profile", "global"];
  let treeNodes = readNodes();
  let shouldEnsure = treeNodes.length < managedKinds.length;
  try {
    const lifecycle = manager.getMemoryTreeLifecycleSnapshot({ kinds: managedKinds });
    shouldEnsure = shouldEnsure || lifecycle.nodes.some((state) => state.dirty || !state.nodePresent);
  } catch {
    // snapshot 构建保持 best-effort，生命周期读取失败时继续使用当前可见节点
  }
  if (!shouldEnsure) {
    return treeNodes;
  }

  try {
    await manager.ensureManagedMemoryTreeFresh({
      kinds: managedKinds,
      nodeLimit: 20,
      rebuildSources: false,
      triggerSource: "mind-profile preflight",
    });
  } catch {
    // mind/profile snapshot 不能因为树层重建失败而阻断运行时摘要
  }

  treeNodes = readNodes();
  return treeNodes;
}

function listProfileStateEntries(
  selectedRecord: ScopedMemoryManagerRecord | undefined,
  selectedAgentId: string,
): ProfileStateEntry[] {
  const manager = selectedRecord?.manager;
  if (!manager) {
    return [];
  }
  const scopedEntries = manager.listProfileStateEntries(12, {
    agentId: selectedAgentId,
    scope: "user",
  });
  if (scopedEntries.length > 0) {
    return scopedEntries;
  }
  return manager.listProfileStateEntries(12, {
    scope: "user",
  });
}

export async function buildMindProfileSnapshot(input: {
  stateDir: string;
  residentAgents?: ResidentAgentDoctorReport;
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  agentId?: string;
}): Promise<MindProfileSnapshot> {
  const selectedRecord = resolveSelectedRecord(input.residentMemoryManagers, input.agentId);
  const selectedAgentId = selectedRecord?.agentId || input.agentId || "default";
  const identityDir = selectedRecord?.stateDir || input.stateDir;
  const identity = await extractIdentityInfo(identityDir);

  const privateMemoryFilePath = path.join(identityDir, "MEMORY.md");
  const sharedMemoryFilePath = selectedRecord?.policy?.sharedStateDir
    ? path.join(selectedRecord.policy.sharedStateDir, "MEMORY.md")
    : path.join(input.stateDir, "team-memory", "MEMORY.md");
  const [privateMemoryFileContent, sharedMemoryFileContent] = await Promise.all([
    readTextFileIfExists(privateMemoryFilePath),
    readTextFileIfExists(sharedMemoryFilePath),
  ]);
  const userProfileFileContent = await readTextFileIfExists(path.join(identityDir, "USER.md"));
  const [hasPrivateMemoryFile, hasSharedMemoryFile] = await Promise.all([
    pathExists(privateMemoryFilePath),
    pathExists(sharedMemoryFilePath),
  ]);

  const profileStateEntries = listProfileStateEntries(selectedRecord, selectedAgentId);
  const profileState = buildProfileStateView(profileStateEntries);
  const userProfileFileSummary = extractMeaningfulLines(userProfileFileContent, 1)[0];
  const privateMemoryFileSummary = extractMeaningfulLines(privateMemoryFileContent, 1)[0];
  const sharedMemoryFileSummary = extractMeaningfulLines(sharedMemoryFileContent, 1)[0];
  const treeNodes = await listMindProfileTreeNodes(selectedRecord, selectedAgentId);
  const treeSummaryLines = treeNodes
    .map((node) => buildTreeNodeSummaryLine(node))
    .filter(Boolean);

  const privateMemoryCount = selectedRecord?.manager.countChunks({
    agentId: selectedAgentId,
    scope: "private",
  }) ?? 0;
  const sharedMemoryCount = selectedRecord?.manager.countChunks({
    agentId: selectedAgentId,
    scope: "shared",
  }) ?? 0;

  const privateSnippets = selectedRecord?.manager.getRecent(
    2,
    { agentId: selectedAgentId, scope: "private" },
    true,
  ).map((item) => ({
    scope: "private" as const,
    sourcePath: item.sourcePath,
    text: buildMemorySnippetText(item),
  })).filter((item) => item.text) ?? [];

  const sharedSnippets = selectedRecord?.manager.getRecent(
    1,
    { agentId: selectedAgentId, scope: "shared" },
    true,
  ).map((item) => ({
    scope: "shared" as const,
    sourcePath: item.sourcePath,
    text: buildMemorySnippetText(item),
  })).filter((item) => item.text) ?? [];

  const residentSummary = input.residentAgents?.summary;
  const residentItems = Array.isArray(input.residentAgents?.agents) ? input.residentAgents.agents : [];
  const topResidents = residentItems
    .slice()
    .sort((left, right) => {
      const pendingDelta = (Number(right.conversationDigest?.pendingMessageCount) || 0) - (Number(left.conversationDigest?.pendingMessageCount) || 0);
      if (pendingDelta !== 0) return pendingDelta;
      const digestDelta = (Number(right.conversationDigest?.lastDigestAt) || 0) - (Number(left.conversationDigest?.lastDigestAt) || 0);
      if (digestDelta !== 0) return digestDelta;
      return (Number(right.lastActiveAt) || 0) - (Number(left.lastActiveAt) || 0);
    })
    .slice(0, 3)
    .map((agent) => ({
      agentId: agent.id,
      displayName: agent.displayName,
      status: agent.status,
      conversationId: agent.mainConversationId || agent.lastConversationId || agent.conversationDigest?.conversationId,
      digestStatus: agent.conversationDigest?.status,
      pendingMessageCount: Number(agent.conversationDigest?.pendingMessageCount) || 0,
      headline: buildResidentHeadline(agent),
    }));

  const topUsageResidents = residentItems
    .filter((agent) => Number(agent.experienceUsageDigest?.usageCount) > 0)
    .slice()
    .sort((left, right) => (Number(right.experienceUsageDigest?.usageCount) || 0) - (Number(left.experienceUsageDigest?.usageCount) || 0))
    .slice(0, 3)
    .map((agent) => ({
      agentId: agent.id,
      displayName: agent.displayName,
      usageCount: Number(agent.experienceUsageDigest?.usageCount) || 0,
      headline: buildExperienceHeadline(agent),
    }));

  const activeResidentCount = Number(residentSummary?.activeCount) || 0;
  const digestReadyCount = Number(residentSummary?.digestReadyCount) || 0;
  const digestUpdatedCount = Number(residentSummary?.digestUpdatedCount) || 0;
  const usageLinkedCount = Number(residentSummary?.experienceUsageLinkedCount) || 0;

  const effectiveUserName = profileState.userName || identity.userName;
  const effectiveUserAvatar = profileState.userAvatar || identity.userAvatar;
  const hasUserProfile = Boolean(
    effectiveUserName
    || effectiveUserAvatar
    || profileState.stateSummaryLines.length > 0
    || userProfileFileSummary,
  );
  const conversationHeadline = residentSummary?.headline
    ? `Residents: ${truncateText(residentSummary.headline, 150)}`
    : undefined;
  const experienceHeadline = topUsageResidents.length > 0
    ? `Experience: ${topUsageResidents.map((item) => item.headline).join(" | ")}`
    : usageLinkedCount > 0
      ? `Experience: linked on ${usageLinkedCount} resident(s)`
      : undefined;

  const summaryLines = dedupeStrings([
    hasUserProfile
      ? `User profile: ${truncateText(effectiveUserName || "-", 48)}${effectiveUserAvatar ? ` / ${truncateText(effectiveUserAvatar, 24)}` : ""}`
      : undefined,
    ...profileState.stateSummaryLines,
    ...treeSummaryLines,
    userProfileFileSummary
      ? `USER.md: ${userProfileFileSummary}`
      : undefined,
    privateMemoryFileSummary ? `Private MEMORY.md: ${privateMemoryFileSummary}` : hasPrivateMemoryFile ? "Private MEMORY.md present" : undefined,
    sharedMemoryFileSummary ? `Shared MEMORY.md: ${sharedMemoryFileSummary}` : hasSharedMemoryFile ? "Shared MEMORY.md present" : undefined,
    conversationHeadline,
    experienceHeadline,
    ...privateSnippets.map((item) => `Private recent: ${item.text}`),
    ...sharedSnippets.map((item) => `Shared recent: ${item.text}`),
  ], 6);

  const profileHeadline = profileState.stateSummaryLines[0]
    || treeSummaryLines[0]
    || summaryLines[0]
    || "Mind/profile snapshot is currently empty";
  const headlineParts = [
    hasUserProfile ? "user ready" : "user missing",
    `private ${privateMemoryCount}`,
    `shared ${sharedMemoryCount}`,
    `digest ${digestReadyCount}/${digestUpdatedCount}`,
    `usage ${usageLinkedCount}`,
  ];
  const available = hasUserProfile
    || hasPrivateMemoryFile
    || hasSharedMemoryFile
    || privateMemoryCount > 0
    || sharedMemoryCount > 0
    || activeResidentCount > 0
    || summaryLines.length > 0;

  return {
    summary: {
      available,
      selectedAgentId,
      headline: headlineParts.join(", "),
      activeResidentCount,
      digestReadyCount,
      digestUpdatedCount,
      usageLinkedCount,
      privateMemoryCount,
      sharedMemoryCount,
      summaryLineCount: summaryLines.length,
      hasUserProfile,
      hasPrivateMemoryFile,
      hasSharedMemoryFile,
    },
    identity: {
      userName: effectiveUserName,
      userAvatar: effectiveUserAvatar,
      hasUserProfile,
      hasPrivateMemoryFile,
      hasSharedMemoryFile,
    },
    conversation: {
      activeResidentCount,
      digestReadyCount,
      digestUpdatedCount,
      topResidents,
    },
    memory: {
      privateMemoryCount,
      sharedMemoryCount,
      privateSummary: buildMemorySummary({
        label: "private",
        count: privateMemoryCount,
        fileSummary: privateMemoryFileSummary,
        recentSnippets: privateSnippets,
      }),
      sharedSummary: buildMemorySummary({
        label: "shared",
        count: sharedMemoryCount,
        fileSummary: sharedMemoryFileSummary,
        recentSnippets: sharedSnippets,
      }),
      recentMemorySnippets: [...privateSnippets, ...sharedSnippets].slice(0, 4),
    },
    experience: {
      usageLinkedCount,
      topUsageResidents,
    },
    profile: {
      headline: profileHeadline,
      summaryLines,
      stateSummaryLines: profileState.stateSummaryLines,
      stateEntries: profileState.stateEntries,
      treeSummaryLines,
      treeNodes,
    },
  };
}
