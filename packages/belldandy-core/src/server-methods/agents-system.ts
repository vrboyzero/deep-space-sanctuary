import type { AgentRegistry, ConversationStore } from "@belldandy/agent";
import type { GatewayEventFrame, GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import type { SubTaskRuntimeStore } from "../task-runtime.js";

import { buildResidentAgentObservabilitySnapshot } from "../resident-agent-observability.js";
import type { ScopedMemoryManagerRecord } from "../resident-memory-managers.js";
import { ResidentAgentRuntimeRegistry } from "../resident-agent-runtime.js";
import { buildAgentRoster } from "../query-runtime-agent-roster.js";
import { ensureResidentAgentSession } from "../query-runtime-agent-sessions.js";
import {
  checkAndConsumeRestartCooldown,
  formatRestartCooldownMessage,
} from "@belldandy/skills";
import { buildAgentLaunchExplainability } from "../agent-launch-explainability.js";
import { createAgent, CreateAgentError } from "../agent-create.js";
import { resolveResidentStateBindingViewForAgent } from "../resident-state-binding.js";

type AgentsSystemMethodContext = {
  stateDir: string;
  clientId: string;
  log: { warn: (scope: string, message: string, meta?: Record<string, unknown>) => void };
  broadcast?: (message: GatewayEventFrame) => void;
  requestSystemRestart?: (reason: string) => void;
  agentRegistry?: AgentRegistry;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  conversationStore: ConversationStore;
  subTaskRuntimeStore?: SubTaskRuntimeStore;
  writeTextFileAtomic?: (
    filePath: string,
    content: string,
    options?: { ensureParent?: boolean; mode?: number },
  ) => Promise<void>;
  inspectAgentPrompt?: (input: {
    agentId?: string;
    conversationId?: string;
    runId?: string;
  }) => Promise<{
    agentId: string;
    metadata?: Record<string, unknown>;
  } & Record<string, unknown>>;
};

export async function handleAgentsSystemMethod(
  req: GatewayReqFrame,
  ctx: AgentsSystemMethodContext,
): Promise<GatewayResFrame | null> {
  switch (req.method) {
    case "system.restart": {
      if (!ctx.requestSystemRestart) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "restart_unavailable", message: "Gateway restart owner is not available." },
        };
      }
      const params = req.params as { reason?: string } | undefined;
      const reason = typeof params?.reason === "string" && params.reason.trim()
        ? params.reason.trim()
        : "system restart requested";
      const cooldownCheck = checkAndConsumeRestartCooldown({ stateDir: ctx.stateDir });
      if (!cooldownCheck.allowed) {
        const message = formatRestartCooldownMessage(cooldownCheck.remainingSeconds);
        ctx.log.warn("system", "system.restart blocked by cooldown", {
          clientId: ctx.clientId,
          remainingSeconds: cooldownCheck.remainingSeconds,
        });
        return { type: "res", id: req.id, ok: false, error: { code: "restart_cooldown", message } };
      }
      ctx.requestSystemRestart(reason);
      return { type: "res", id: req.id, ok: true };
    }

    case "agents.list": {
      const roster = await buildAgentRoster({
        stateDir: ctx.stateDir,
        agentRegistry: ctx.agentRegistry,
        residentAgentRuntime: ctx.residentAgentRuntime,
      });
      const agents = roster.map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        name: agent.name,
        avatar: agent.avatar,
        model: agent.model,
      }));
      return { type: "res", id: req.id, ok: true, payload: { agents } };
    }

    case "agents.roster.get": {
      const roster = await buildAgentRoster({
        stateDir: ctx.stateDir,
        agentRegistry: ctx.agentRegistry,
        residentAgentRuntime: ctx.residentAgentRuntime,
      });
      if ((ctx.residentMemoryManagers?.length ?? 0) > 0) {
        const observability = await buildResidentAgentObservabilitySnapshot({
          agents: roster,
          residentMemoryManagers: ctx.residentMemoryManagers,
          conversationStore: ctx.conversationStore,
          subTaskRuntimeStore: ctx.subTaskRuntimeStore,
        });
        return { type: "res", id: req.id, ok: true, payload: { agents: observability.agents } };
      }
      return { type: "res", id: req.id, ok: true, payload: { agents: roster } };
    }

    case "agent.session.ensure": {
      const params = req.params as { agentId?: string } | undefined;
      try {
        const payload = ensureResidentAgentSession({
          agentId: params?.agentId,
          agentRegistry: ctx.agentRegistry,
          residentAgentRuntime: ctx.residentAgentRuntime,
          conversationStore: ctx.conversationStore,
        });
        return { type: "res", id: req.id, ok: true, payload };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "invalid_agent",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case "agent.create": {
      if (!ctx.writeTextFileAtomic) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "not_available", message: "Agent creation is not available." },
        };
      }
      const params = asRecord(req.params);
      try {
        const payload = await createAgent({
          stateDir: ctx.stateDir,
          writeTextFileAtomic: ctx.writeTextFileAtomic,
          id: typeof params.id === "string" ? params.id : undefined,
          displayName: typeof params.displayName === "string" ? params.displayName : undefined,
          model: typeof params.model === "string" ? params.model : undefined,
          systemPromptOverride: typeof params.systemPromptOverride === "string" ? params.systemPromptOverride : undefined,
        });
        return { type: "res", id: req.id, ok: true, payload };
      } catch (error) {
        if (error instanceof CreateAgentError) {
          return {
            type: "res",
            id: req.id,
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          };
        }
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "agent_create_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case "agents.prompt.inspect": {
      const params = asRecord(req.params);
      const agentId = typeof params.agentId === "string" && params.agentId.trim()
        ? params.agentId.trim()
        : undefined;
      const conversationId = typeof params.conversationId === "string" && params.conversationId.trim()
        ? params.conversationId.trim()
        : undefined;
      const runId = typeof params.runId === "string" && params.runId.trim()
        ? params.runId.trim()
        : undefined;
      if (!ctx.inspectAgentPrompt) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "not_available", message: "Prompt inspection is not available." },
        };
      }
      try {
        const inspection = await ctx.inspectAgentPrompt({ agentId, conversationId, runId });
        const residentStateBinding = resolveResidentStateBindingViewForAgent(
          ctx.stateDir,
          ctx.agentRegistry,
          agentId ?? inspection.agentId,
        );
        const launchExplainability = buildAgentLaunchExplainability({
          agentRegistry: ctx.agentRegistry,
          agentId: agentId ?? inspection.agentId,
        });
        const rawMetadata = inspection.metadata;
        const metadata = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
          ? { ...rawMetadata }
          : {};
        if (residentStateBinding) {
          metadata.residentStateBinding = residentStateBinding;
        }
        if (launchExplainability) {
          metadata.launchExplainability = launchExplainability;
        }
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: {
            ...inspection,
            metadata,
          },
        };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "prompt_inspect_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
