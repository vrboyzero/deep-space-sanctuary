import path from "node:path";

import {
  extractIdentityInfo,
  isResidentAgentProfile,
  resolveAgentProfileMetadata,
  type AgentRegistry,
  type AgentProfileCatalogMetadata,
  type AgentProfile,
} from "@belldandy/agent";
import { resolveResidentMemoryPolicy } from "./resident-memory-policy.js";
import type { ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";

function resolveAgentIdentityDir(
  rootDir: string,
  agentRegistry: AgentRegistry | undefined,
  agentId: string | undefined,
): { dir: string; profileId: string } | null {
  const resolvedAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : "default";
  if (resolvedAgentId === "default") {
    return { dir: rootDir, profileId: "default" };
  }

  const profile = agentRegistry?.getProfile(resolvedAgentId);
  if (!profile) return null;

  const metadata = resolveAgentProfileMetadata(profile);
  return {
    dir: path.join(rootDir, "agents", metadata.workspaceDir),
    profileId: profile.id,
  };
}

async function buildAgentRosterItem(input: {
  stateDir: string;
  agentRegistry?: AgentRegistry;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  profile: AgentProfile;
}): Promise<{
  id: string;
  kind: "resident" | "worker";
  displayName: string;
  name: string;
  avatar?: string;
  model: string;
  workspaceBinding: "current" | "custom";
  sessionNamespace: string;
  memoryMode: "isolated" | "shared" | "hybrid";
  memoryPolicy: ReturnType<typeof resolveResidentMemoryPolicy>;
  catalog: AgentProfileCatalogMetadata;
  status: string;
  mainConversationId?: string;
  lastConversationId?: string;
  lastActiveAt?: number;
}> {
  const identityTarget = resolveAgentIdentityDir(input.stateDir, input.agentRegistry, input.profile.id);
  const identityInfo = identityTarget ? await extractIdentityInfo(identityTarget.dir) : {};
  const runtime = input.residentAgentRuntime.ensureMainConversation(input.profile.id);
  const metadata = resolveAgentProfileMetadata(input.profile);
  const memoryPolicy = resolveResidentMemoryPolicy(input.stateDir, input.profile);
  return {
    id: input.profile.id,
    kind: metadata.kind,
    displayName: input.profile.displayName,
    name: identityInfo.agentName || input.profile.displayName,
    avatar: identityInfo.agentAvatar || undefined,
    model: input.profile.model,
    workspaceBinding: metadata.workspaceBinding,
    sessionNamespace: metadata.sessionNamespace,
    memoryMode: metadata.memoryMode,
    memoryPolicy,
    catalog: metadata.catalog,
    status: runtime.status,
    mainConversationId: runtime.mainConversationId,
    lastConversationId: runtime.lastConversationId,
    lastActiveAt: runtime.lastActiveAt,
  };
}

export async function buildAgentRoster(input: {
  stateDir: string;
  agentRegistry?: AgentRegistry;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
}): Promise<Array<Awaited<ReturnType<typeof buildAgentRosterItem>>>> {
  const profiles = (input.agentRegistry?.list() ?? []).filter((profile) => isResidentAgentProfile(profile));
  return Promise.all(profiles.map((profile) => buildAgentRosterItem({
    stateDir: input.stateDir,
    agentRegistry: input.agentRegistry,
    residentAgentRuntime: input.residentAgentRuntime,
    profile,
  })));
}
