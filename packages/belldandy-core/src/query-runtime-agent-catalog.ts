import path from "node:path";

import type { GatewayResFrame } from "@belldandy/protocol";
import type { ToolContractFamily, ToolContractRiskLevel } from "@belldandy/skills";
import {
  buildDefaultProfile,
  extractIdentityInfo,
  isResidentAgentProfile,
  type AgentProfile,
  type AgentRegistry,
  resolveAgentProfileMetadata,
} from "@belldandy/agent";

import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";
import type { ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";

type AgentCatalogQueryRuntimeMethod = "agent.catalog.get";

const ROLE_DEFAULT_ALLOWED_TOOL_FAMILIES: Partial<Record<"default" | "coder" | "researcher" | "verifier", ToolContractFamily[]>> = {
  coder: ["workspace-read", "workspace-write", "patch", "command-exec", "memory", "goal-governance"],
  researcher: ["network-read", "workspace-read", "browser", "memory", "goal-governance"],
  verifier: ["workspace-read", "command-exec", "browser", "memory", "goal-governance"],
};

const ROLE_DEFAULT_PERMISSION_MODE: Partial<Record<"default" | "coder" | "researcher" | "verifier", "plan" | "acceptEdits" | "confirm">> = {
  researcher: "plan",
  coder: "confirm",
  verifier: "confirm",
};

const ROLE_DEFAULT_MAX_RISK_LEVEL: Partial<Record<"default" | "coder" | "researcher" | "verifier", ToolContractRiskLevel>> = {
  researcher: "medium",
  coder: "high",
  verifier: "high",
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean),
  )];
}

function resolveCatalogDefaultRole(profile: AgentProfile): "default" | "coder" | "researcher" | "verifier" {
  return profile.defaultRole === "coder"
    || profile.defaultRole === "researcher"
    || profile.defaultRole === "verifier"
    ? profile.defaultRole
    : "default";
}

function buildCatalogMetadata(profile: AgentProfile) {
  const defaultRole = resolveCatalogDefaultRole(profile);
  const explicitAllowedToolFamilies = normalizeStringArray(profile.defaultAllowedToolFamilies) as ToolContractFamily[];
  return {
    whenToUse: normalizeStringArray(profile.whenToUse),
    defaultRole,
    defaultPermissionMode: profile.defaultPermissionMode === "plan"
      || profile.defaultPermissionMode === "acceptEdits"
      || profile.defaultPermissionMode === "confirm"
      ? profile.defaultPermissionMode
      : ROLE_DEFAULT_PERMISSION_MODE[defaultRole],
    defaultAllowedToolFamilies: explicitAllowedToolFamilies.length > 0
      ? explicitAllowedToolFamilies
      : ROLE_DEFAULT_ALLOWED_TOOL_FAMILIES[defaultRole],
    defaultMaxToolRiskLevel: profile.defaultMaxToolRiskLevel === "low"
      || profile.defaultMaxToolRiskLevel === "medium"
      || profile.defaultMaxToolRiskLevel === "high"
      || profile.defaultMaxToolRiskLevel === "critical"
      ? profile.defaultMaxToolRiskLevel
      : ROLE_DEFAULT_MAX_RISK_LEVEL[defaultRole],
    methods: normalizeStringArray(profile.methods),
    skills: normalizeStringArray(profile.skills),
    handoffStyle: profile.handoffStyle === "structured"
      ? "structured"
      : profile.kind === "worker"
        ? "structured"
        : "summary",
  };
}

export type QueryRuntimeAgentCatalogContext = {
  requestId: string;
  stateDir: string;
  agentRegistry?: AgentRegistry;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  runtimeObserver?: QueryRuntimeObserver<AgentCatalogQueryRuntimeMethod>;
};

function resolveIdentityDir(
  stateDir: string,
  profile: AgentProfile,
  metadata: ReturnType<typeof resolveAgentProfileMetadata>,
): string {
  if (profile.id === "default") return stateDir;
  return path.join(stateDir, "agents", metadata.workspaceDir);
}

async function buildCatalogItem(input: {
  stateDir: string;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  profile: AgentProfile;
}) {
  const metadata = resolveAgentProfileMetadata(input.profile);
  const identityInfo = await extractIdentityInfo(resolveIdentityDir(input.stateDir, input.profile, metadata));
  const runtime = isResidentAgentProfile(input.profile)
    ? input.residentAgentRuntime.ensureMainConversation(input.profile.id)
    : undefined;

  return {
    id: input.profile.id,
    displayName: input.profile.displayName,
    model: input.profile.model,
    name: identityInfo.agentName || input.profile.displayName,
    avatar: identityInfo.agentAvatar || undefined,
    metadata: {
      ...metadata,
      catalog: buildCatalogMetadata(input.profile),
    },
    runtime: runtime
      ? {
        status: runtime.status,
        mainConversationId: runtime.mainConversationId,
        lastConversationId: runtime.lastConversationId,
        lastActiveAt: runtime.lastActiveAt,
      }
      : undefined,
  };
}

export async function handleAgentCatalogGetWithQueryRuntime(
  ctx: QueryRuntimeAgentCatalogContext,
  params: {
    agentId?: string;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "agent.catalog.get" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    const requestedAgentId = typeof params.agentId === "string" && params.agentId.trim()
      ? params.agentId.trim()
      : undefined;
    const profiles = ctx.agentRegistry?.list() ?? [buildDefaultProfile()];
    const filteredProfiles = requestedAgentId
      ? profiles.filter((profile) => profile.id === requestedAgentId)
      : profiles;

    queryRuntime.mark("request_validated", {
      detail: {
        agentId: requestedAgentId,
        totalProfiles: profiles.length,
        returnedProfiles: filteredProfiles.length,
      },
    });

    const agents = await Promise.all(filteredProfiles.map((profile) => buildCatalogItem({
      stateDir: ctx.stateDir,
      residentAgentRuntime: ctx.residentAgentRuntime,
      profile,
    })));

    queryRuntime.mark("runtime_report_built", {
      detail: {
        returnedProfiles: agents.length,
        residentProfiles: agents.filter((item) => item.metadata.kind === "resident").length,
        workerProfiles: agents.filter((item) => item.metadata.kind === "worker").length,
      },
    });

    queryRuntime.mark("completed", {
      detail: {
        returnedProfiles: agents.length,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        requested: {
          agentId: requestedAgentId,
        },
        summary: {
          totalCount: agents.length,
          residentCount: agents.filter((item) => item.metadata.kind === "resident").length,
          workerCount: agents.filter((item) => item.metadata.kind === "worker").length,
        },
        agents,
      },
    };
  });
}
